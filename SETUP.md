#  QueryBot Setup Guide

This guide will walk you through setting up QueryBot on your local development environment.

## 📋 Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** >= 16.0.0 ([Download](https://nodejs.org/))
- **Python** >= 3.12 ([Download](https://www.python.org/downloads/))
- **UV** (Python package manager) ([Install Guide](https://docs.astral.sh/uv/getting-started/installation/))
- **Git** ([Download](https://git-scm.com/downloads))
- **Docker** (optional, for containerized deployment) ([Download](https://www.docker.com/products/docker-desktop))

### Verify Prerequisites

```bash
# Check Node.js version
node --version

# Check Python version
python --version

# Check UV installation
uv --version

# Check Git installation
git --version

# Check Docker installation (optional)
docker --version
```

## 🔧 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/VedikaPande/QueryBot.git
cd QueryBot
```

### 2. Set Up Each Service

#### Frontend (React + TypeScript + Vite)

```bash
cd client
npm install
cd ..
```

#### Authentication Server (Flask + SQLAlchemy)

```bash
cd server
uv sync
cd ..
```

#### SQLite Server (Node.js + Express)

```bash
cd sqlite_server
npm install
cd ..
```

#### LangGraph Agent (Python + LangGraph)

```bash
cd langgraph_agent
uv sync
cd ..
```

## 🔑 Environment Configuration

Create `.env` files in the appropriate directories with the following configurations:

### `server/.env` (Flask Authentication Server)

```env
# Database Configuration
# For PostgreSQL (recommended for production):
DATABASE_URL=postgresql://username:password@host:port/database

# For SQLite (development):
DATABASE_URL=sqlite:///querybot.db

# Security Keys (CHANGE IN PRODUCTION)
SECRET_KEY=your-super-secret-key-change-in-production-min-32-chars
JWT_SECRET_KEY=your-jwt-secret-key-change-in-production-min-32-chars

# Environment
FLASK_ENV=development

# LangGraph Configuration
LANGSMITH_API_KEY=your-langsmith-api-key-from-langsmith-console
LANGGRAPH_API_URL=http://localhost:8000

# CORS Settings (adjust for production)
CORS_ORIGINS=["http://localhost:5173", "http://127.0.0.1:5173"]
```

### `sqlite_server/.env` (SQLite Server)

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=*

# File Upload Settings
MAX_FILE_SIZE=104857600          # 100MB in bytes
DB_CLEANUP_INTERVAL=3600000      # 1 hour in milliseconds
DB_FILE_RETENTION=14400000       # 4 hours in milliseconds

# Logging
LOG_LEVEL=info
```

### `langgraph_agent/.env` (LangGraph Agent)

```env
# Groq Configuration
GROQ_API_KEY=your-groq-api-key-from-console-groq-com

# LangSmith Configuration (for monitoring and debugging)
LANGSMITH_API_KEY=your-langsmith-api-key-from-langsmith-console
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=querybot-agent

# Model Configuration
GROQ_MODEL=llama-3.1-70b-versatile
TEMPERATURE=0.1

# Chart Generation Settings
CHART_OUTPUT_DIR=./generated_charts
MAX_CHART_WIDTH=1200
MAX_CHART_HEIGHT=800
```

### `client/.env` (React Frontend)

```env
# API Configuration
VITE_API_BASE_URL=http://localhost:5000/api
VITE_SQLITE_API_BASE_URL=http://localhost:3001

# Application Configuration
VITE_APP_NAME=QueryBot
VITE_APP_VERSION=1.0.0

# Development Configuration
VITE_LOG_LEVEL=info
```

## 🗂️ Database Setup

### For SQLite (Development)

The SQLite database will be created automatically when you first run the Flask server.

### For PostgreSQL (Production)

1. **Install PostgreSQL** ([Download](https://www.postgresql.org/download/))

2. **Create a database:**
   ```sql
   CREATE DATABASE querybot;
   CREATE USER querybot_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE querybot TO querybot_user;
   ```

3. **Update the DATABASE_URL in `server/.env`:**
   ```env
   DATABASE_URL=postgresql://querybot_user:your_password@localhost:5432/querybot
   ```

4. **Run database migrations:**
   ```bash
   cd server
   uv run flask --app main.py db upgrade
   ```

## 🎯 Running the Application

### Development Mode (Recommended)

Start each service in a separate terminal:

#### Terminal 1: SQLite Server
```bash
cd sqlite_server
npm run dev
```
**Status**: Server running on http://localhost:3001

#### Terminal 2: Flask Authentication Server
```bash
cd server
uv run python main.py
```
**Status**: Server running on http://localhost:5000

#### Terminal 3: LangGraph Agent
```bash
cd langgraph_agent
langgraph dev 
```
**Status**: Agent running on http://localhost:8000

#### Terminal 4: React Frontend
```bash
cd client
npm run dev
```
**Status**: Frontend running on http://localhost:5173

### Production Mode

#### 1. Build all services:

```bash
# Build Frontend
cd client
npm run build

# Build SQLite Server
cd ../sqlite_server
npm run build

# No build needed for Flask and LangGraph (Python services)
```

#### 2. Start services:

```bash
# Start Frontend (Preview mode)
cd client
npm run preview &

# Start SQLite Server
cd ../sqlite_server
npm start &

# Start Flask Server
cd ../server
FLASK_ENV=production uv run python main.py &

# Start LangGraph Agent
cd ../langgraph_agent
langgraph dev --host 0.0.0.0 --port 8000 &
```

### Docker Deployment

For containerized deployment:

```bash
cd langgraph_agent
docker-compose up --build
```

This will start the LangGraph agent in a Docker container with chart generation capabilities.

## 🌐 Access Points & Health Checks

Once all services are running, verify they're working:

### Service URLs
- **Frontend**: http://localhost:5173
- **Flask API**: http://localhost:5000
- **SQLite Server**: http://localhost:3001
- **LangGraph Agent**: http://localhost:8000

### Health Check Commands

```bash
# Check Flask server
curl http://localhost:5000/health

# Check SQLite server
curl http://localhost:3001/health

# Check LangGraph agent
curl http://localhost:8000/health

# Check if frontend is accessible
curl http://localhost:5173
```

Expected responses should return status 200 with health information.

### API Keys Setup

#### Getting Groq API Key
1. Visit [console.groq.com](https://console.groq.com)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy and paste into `langgraph_agent/.env`

#### Getting LangSmith API Key
1. Visit [smith.langchain.com](https://smith.langchain.com)
2. Sign up or log in
3. Go to Settings > API Keys
4. Create a new API key
5. Copy and paste into `langgraph_agent/.env` and `server/.env`

---

**Congratulations! 🎉** Your QueryBot development environment should now be ready to use.
