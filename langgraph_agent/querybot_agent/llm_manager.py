"""
LLM access.

One entry point for every model call in the workflow, so the choice of provider
is a configuration detail rather than something each node knows about. Groq,
OpenAI, Anthropic and Google are supported; integrations are imported lazily so a
deployment only needs the package for the provider it actually uses.

Also owns the JSON parsing, which has to tolerate the fenced-code and
commentary-wrapped output models frequently return.
"""
import importlib
import json
import logging
import os
import re
import threading
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate

from querybot_agent.config import PROVIDER_DEFAULT_MODELS, settings

logger = logging.getLogger(__name__)


class LLMConfigurationError(RuntimeError):
    """Raised when the selected provider cannot be used as configured."""


class _Provider:
    """How to construct one provider's chat client."""

    def __init__(
        self,
        module: str,
        class_name: str,
        api_key_env: str,
        package: str,
        max_tokens_kwarg: str = 'max_tokens',
    ) -> None:
        self.module = module
        self.class_name = class_name
        self.api_key_env = api_key_env
        self.package = package
        # Google's integration names this max_output_tokens; the others use
        # max_tokens, and passing the wrong one is a hard constructor error.
        self.max_tokens_kwarg = max_tokens_kwarg


PROVIDERS: dict[str, _Provider] = {
    'groq': _Provider('langchain_groq', 'ChatGroq', 'GROQ_API_KEY', 'langchain-groq'),
    'openai': _Provider('langchain_openai', 'ChatOpenAI', 'OPENAI_API_KEY', 'langchain-openai'),
    'anthropic': _Provider(
        'langchain_anthropic', 'ChatAnthropic', 'ANTHROPIC_API_KEY', 'langchain-anthropic'
    ),
    'google': _Provider(
        'langchain_google_genai',
        'ChatGoogleGenerativeAI',
        'GOOGLE_API_KEY',
        'langchain-google-genai',
        max_tokens_kwarg='max_output_tokens',
    ),
}

# Sampling parameters were removed from these Claude models: a request carrying
# `temperature` is rejected with a 400 rather than ignored. Determinism comes
# from the prompts instead, which already demand JSON-only output.
ANTHROPIC_MODELS_WITHOUT_SAMPLING = (
    'claude-fable-5',
    'claude-mythos-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-5',
)


def _build_client() -> BaseChatModel:
    """Construct the chat client for the configured provider."""
    provider_name = settings.llm_provider
    provider = PROVIDERS.get(provider_name)

    if provider is None:
        supported = ', '.join(sorted(PROVIDERS))
        raise LLMConfigurationError(
            f'LLM_PROVIDER={provider_name!r} is not supported. Choose one of: {supported}.'
        )

    model = settings.model
    if not model:
        raise LLMConfigurationError(
            f'No model is configured for provider {provider_name!r}. Set LLM_MODEL, or use a '
            f'provider with a default: {", ".join(sorted(PROVIDER_DEFAULT_MODELS))}.'
        )

    if not os.environ.get(provider.api_key_env):
        raise LLMConfigurationError(
            f'LLM_PROVIDER={provider_name!r} needs {provider.api_key_env} to be set.'
        )

    try:
        client_class = getattr(importlib.import_module(provider.module), provider.class_name)
    except ImportError as exc:
        raise LLMConfigurationError(
            f'Provider {provider_name!r} requires the {provider.package} package: '
            f'`uv add {provider.package}`.'
        ) from exc

    kwargs: dict[str, Any] = {
        'model': model,
        'max_retries': settings.max_retries,
        provider.max_tokens_kwarg: settings.max_output_tokens,
    }

    if not _rejects_temperature(provider_name, model):
        kwargs['temperature'] = settings.temperature

    logger.info('Using %s model %s', provider_name, model)
    return client_class(**kwargs)


def _rejects_temperature(provider_name: str, model: str) -> bool:
    """Whether this provider and model combination refuses sampling parameters."""
    if provider_name != 'anthropic':
        return False
    return any(model.startswith(prefix) for prefix in ANTHROPIC_MODELS_WITHOUT_SAMPLING)


class LLMManager:
    """Single entry point for model calls."""

    # The client is stateless and thread-safe; one instance is shared across the
    # many manager objects the workflow creates, instead of opening a new client
    # per node on every run.
    _shared_client: Optional[BaseChatModel] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.llm = self._client()

    @classmethod
    def _client(cls) -> BaseChatModel:
        if cls._shared_client is None:
            with cls._lock:
                if cls._shared_client is None:
                    cls._shared_client = _build_client()
        return cls._shared_client

    @classmethod
    def reset(cls) -> None:
        """Drop the cached client so the next call re-reads the configuration."""
        with cls._lock:
            cls._shared_client = None

    def invoke(self, prompt: ChatPromptTemplate, **kwargs: Any) -> str:
        """Render the prompt, call the model, and return the text response."""
        messages = prompt.format_messages(**kwargs)
        response = self.llm.invoke(messages)

        return _text_of(response.content)

    def invoke_json(self, prompt: ChatPromptTemplate, **kwargs: Any) -> Any:
        """
        Call the model and parse the response as JSON.

        Models routinely wrap JSON in a ```json fence or add a sentence of
        commentary. Rather than letting the strict parser fail the whole run, the
        outermost JSON object is extracted as a fallback.
        """
        raw = self.invoke(prompt, **kwargs)

        try:
            return JsonOutputParser().parse(raw)
        except Exception:  # noqa: BLE001 - fall through to lenient extraction
            logger.debug('Strict JSON parse failed, attempting extraction')

        cleaned = re.sub(r'^\s*```(?:json)?|```\s*$', '', raw.strip(), flags=re.MULTILINE).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        raise ValueError(f'The model did not return valid JSON: {raw[:200]}')


def _text_of(content: Any) -> str:
    """
    Flatten a response body to text.

    Providers differ here: Groq and OpenAI return a plain string, while Anthropic
    and Google return a list of blocks. Reasoning models add thinking blocks with
    no ``text`` key, which must be dropped rather than stringified — otherwise
    their repr lands in the middle of the JSON the caller is about to parse.
    """
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get('type') in ('thinking', 'redacted_thinking'):
                    continue
                parts.append(str(block.get('text', '')))
            else:
                parts.append(str(block))
        return ''.join(parts)

    return str(content)
