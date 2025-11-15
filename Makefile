# ================================
# Supabase Self-hosted MCP Server
# ================================
# Docker-First Development
# Based on makefile-global/templates/standalone.mk
# ================================

.DEFAULT_GOAL := help

# ========== Environment Settings ==========
export COMPOSE_DOCKER_CLI_BUILD := 1
export DOCKER_BUILDKIT := 1

# Auto-detect project name from directory
PROJECT ?= $(notdir $(shell pwd))
export COMPOSE_PROJECT_NAME := $(PROJECT)

# Load environment variables from .env
-include .env
export

# Workspace service name
WORKSPACE_SVC ?= workspace

# MCP Server service name
MCP_SVC ?= mcp-server

# Colors
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
NC := \033[0m

# ========== Help ==========
.PHONY: help
help:
	@echo ""
	@echo "$(BLUE)Supabase Self-hosted MCP Server - Available Commands:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Project: $(PROJECT)$(NC)"
	@echo ""

# ========== Core Commands ==========

.PHONY: up
up: ## Start MCP server
	@echo "$(GREEN)Starting MCP server...$(NC)"
	@docker compose up mcp-server -d --remove-orphans
	@echo "$(GREEN)✅ MCP server started on http://localhost:$(PORT)$(NC)"

.PHONY: up-workspace
up-workspace: ## Start workspace only (for development)
	@echo "$(GREEN)Starting workspace...$(NC)"
	@docker compose up workspace -d --remove-orphans
	@echo "$(GREEN)✅ Workspace started$(NC)"

.PHONY: down
down: ## Stop all services
	@echo "$(YELLOW)Stopping services...$(NC)"
	@docker compose down --remove-orphans
	@echo "$(GREEN)✅ Stopped$(NC)"

.PHONY: restart
restart: down up ## Full restart

.PHONY: logs
logs: ## Show MCP server logs
	@docker compose logs -f mcp-server

.PHONY: logs-workspace
logs-workspace: ## Show workspace logs
	@docker compose logs -f workspace

.PHONY: ps
ps: ## Show container status
	@docker compose ps

# ========== Development Commands ==========

.PHONY: workspace
workspace: ## Enter workspace shell
	@docker compose exec $(WORKSPACE_SVC) sh

.PHONY: install
install: ## Install dependencies in workspace
	@echo "$(BLUE)Installing dependencies in container...$(NC)"
	@docker compose exec $(WORKSPACE_SVC) pnpm install --frozen-lockfile
	@echo "$(GREEN)✅ Dependencies installed$(NC)"

.PHONY: build
build: ## Build TypeScript in workspace
	@echo "$(BLUE)Building TypeScript in container...$(NC)"
	@docker compose exec $(WORKSPACE_SVC) pnpm build
	@echo "$(GREEN)✅ Build complete$(NC)"

.PHONY: dev
dev: ## Run dev mode in workspace (with auto-reload)
	@echo "$(BLUE)Starting dev mode...$(NC)"
	@docker compose exec $(WORKSPACE_SVC) pnpm dev

.PHONY: typecheck
typecheck: ## Run TypeScript type checking
	@docker compose exec $(WORKSPACE_SVC) pnpm typecheck

# ========== Testing Commands ==========

.PHONY: test
test: ## Run tests (placeholder)
	@echo "$(YELLOW)No tests implemented yet$(NC)"

.PHONY: health
health: ## Check MCP server health
	@curl -s http://localhost:$(PORT)/health | jq .

.PHONY: list-tools
list-tools: ## List available MCP tools
	@curl -s http://localhost:$(PORT)/mcp \
		-H "Content-Type: application/json" \
		-d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .

# ========== Clean Commands ==========

.PHONY: clean
clean: ## Clean Mac host garbage - ALL build artifacts should be in Docker volumes
	@echo "$(YELLOW)🧹 Cleaning Mac host garbage (Docker-First violation artifacts)...$(NC)"
	@echo "$(YELLOW)   ⚠️  These files should NOT exist on Mac host in Docker-First dev$(NC)"
	@find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -name ".cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@find . -name ".DS_Store" -type f -delete 2>/dev/null || true
	@find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
	@echo "$(GREEN)✅ Mac host cleaned$(NC)"
	@echo "$(GREEN)   If files were found, your Docker volume setup needs fixing!$(NC)"

.PHONY: clean-all
clean-all: down ## Full cleanup (removes Docker volumes - destroys data!)
	@echo "$(YELLOW)⚠️  Removing all volumes (node_modules, dist, pnpm-store)...$(NC)"
	@docker compose down -v
	@echo "$(GREEN)✅ Complete cleanup done$(NC)"

# ========== Config ==========

.PHONY: config
config: ## Show effective docker compose configuration
	@docker compose config

.PHONY: validate-env
validate-env: ## Validate .env configuration
	@echo "$(BLUE)Validating .env file...$(NC)"
	@test -f .env || (echo "$(YELLOW)⚠️  .env file not found. Copy from .env.example$(NC)" && exit 1)
	@grep -q "PG_DSN=" .env && echo "$(GREEN)✅ PG_DSN configured$(NC)" || echo "$(YELLOW)⚠️  PG_DSN missing$(NC)"
	@grep -q "POSTGREST_URL=" .env && echo "$(GREEN)✅ POSTGREST_URL configured$(NC)" || echo "$(YELLOW)⚠️  POSTGREST_URL missing$(NC)"
	@grep -q "POSTGREST_JWT=" .env && echo "$(GREEN)✅ POSTGREST_JWT configured$(NC)" || echo "$(YELLOW)⚠️  POSTGREST_JWT missing$(NC)"
