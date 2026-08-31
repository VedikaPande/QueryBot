"""
Agent configuration, resolved from the environment.
"""
import os
from dataclasses import dataclass, field


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, ''))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, ''))
    except ValueError:
        return default


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ('false', '0', 'no', 'off')


# Model to use for each provider when LLM_MODEL is not set. The workflow itself
# is provider-agnostic — every node goes through LLMManager — so switching is one
# environment variable. Provider catalogues change faster than this file, so set
# LLM_MODEL explicitly if a name here has been retired or renamed.
PROVIDER_DEFAULT_MODELS: dict[str, str] = {
    'groq': 'openai/gpt-oss-120b',
    'openai': 'gpt-5',
    'anthropic': 'claude-opus-5',
    'google': 'gemini-2.5-pro',
}


@dataclass(frozen=True)
class Settings:
    """Runtime settings resolved from the environment."""

    # Dataset service
    sqlite_service_url: str = field(
        default_factory=lambda: os.environ.get('SQLITE_SERVICE_URL', 'http://localhost:3001').rstrip('/')
    )
    service_token: str = field(default_factory=lambda: os.environ.get('SERVICE_TOKEN', ''))
    request_timeout: int = field(default_factory=lambda: _int_env('SQLITE_REQUEST_TIMEOUT', 60))

    # Model provider: one of PROVIDER_DEFAULT_MODELS. Groq is the default because
    # it is the cheapest and fastest of the four for this workload.
    llm_provider: str = field(
        default_factory=lambda: os.environ.get('LLM_PROVIDER', 'groq').strip().lower()
    )
    # Overrides the provider's default model. Leave unset to take the default.
    llm_model: str = field(default_factory=lambda: os.environ.get('LLM_MODEL', '').strip())
    # Predates multi-provider support; still honoured when the provider is Groq.
    groq_model: str = field(default_factory=lambda: os.environ.get('GROQ_MODEL', '').strip())

    temperature: float = field(default_factory=lambda: _float_env('TEMPERATURE', 0.0))
    max_retries: int = field(default_factory=lambda: _int_env('LLM_MAX_RETRIES', 2))
    # Every provider except Groq needs an explicit output cap, and the defaults
    # are too low for insight generation: langchain-anthropic, for instance,
    # defaults to 1024 tokens, which truncates the analysis mid-sentence.
    max_output_tokens: int = field(default_factory=lambda: _int_env('LLM_MAX_OUTPUT_TOKENS', 4096))

    # Chart generation
    charts_dir: str = field(default_factory=lambda: os.environ.get('CHART_OUTPUT_DIR', 'generated_charts'))
    chart_timeout: int = field(default_factory=lambda: _int_env('CHART_TIMEOUT', 120))
    chart_image_name: str = field(
        default_factory=lambda: os.environ.get('CHART_EXECUTOR_IMAGE', 'querybot-chart-executor')
    )
    # Docker isolates chart code from the host. Disabling it runs generated code
    # in-process and is intended only for environments without a Docker daemon.
    chart_docker_enabled: bool = field(
        default_factory=lambda: os.environ.get('CHART_DOCKER_ENABLED', 'true').lower() != 'false'
    )

    # Query limits
    max_result_rows: int = field(default_factory=lambda: _int_env('MAX_RESULT_ROWS', 5000))
    # Rows sent to the model for analysis; the full set still reaches the client.
    llm_sample_rows: int = field(default_factory=lambda: _int_env('LLM_SAMPLE_ROWS', 30))

    # How many times a failing query is rewritten using the database's error
    # message as feedback. Two repairs recovers most fixable failures; beyond that
    # the model tends to loop on the same mistake, so it is not worth the latency.
    max_sql_repairs: int = field(default_factory=lambda: _int_env('MAX_SQL_REPAIRS', 2))

    # Follow-up question suggestions after each answer.
    suggest_followups: bool = field(
        default_factory=lambda: os.environ.get('SUGGEST_FOLLOWUPS', 'true').lower() != 'false'
    )

    # Conversational refinement: recognise a follow-up that only changes how the
    # previous answer is presented ("make it a pie chart") and rewrite that result
    # instead of running the whole workflow again. Disable to always re-query.
    refine_followups: bool = field(default_factory=lambda: _bool_env('REFINE_FOLLOWUPS', True))

    @property
    def model(self) -> str:
        """The model name to call, resolved from the provider and overrides."""
        if self.llm_model:
            return self.llm_model
        if self.llm_provider == 'groq' and self.groq_model:
            return self.groq_model
        return PROVIDER_DEFAULT_MODELS.get(self.llm_provider, '')

    @property
    def auth_headers(self) -> dict[str, str]:
        return {'Authorization': f'Bearer {self.service_token}'} if self.service_token else {}


settings = Settings()
