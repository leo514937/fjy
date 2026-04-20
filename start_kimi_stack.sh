#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT_DIR}/kimi-agent-knowledge-base-collab/app"
QAGENT_DIR="${ROOT_DIR}/QAgent"
WEB_RUNTIME_DIR="${ROOT_DIR}/kimi-agent-knowledge-base-collab/.qagent-web-runtime"
LOG_DIR="${ROOT_DIR}/.run-logs"

BACKEND_PORT="${PORT:-8787}"
FRONTEND_PORT="${VITE_PORT:-5173}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
WIKIMG_ROOT="${WIKIMG_ROOT:-${ROOT_DIR}/Ontology_Factory}"
WIKIMG_PROFILE="${WIKIMG_PROFILE:-kimi}"
KNOWLEDGE_BASE_PROVIDER="${KNOWLEDGE_BASE_PROVIDER:-wikimg}"

mkdir -p "${LOG_DIR}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    return
  fi

  echo "关闭占用端口 ${port} 的旧进程: ${pids}"
  kill ${pids} 2>/dev/null || true
  sleep 1

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "强制结束仍占用端口 ${port} 的进程: ${pids}"
    kill -9 ${pids} 2>/dev/null || true
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local retries="${3:-40}"

  for ((i = 1; i <= retries; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "${name} 已就绪: ${url}"
      return 0
    fi
    sleep 1
  done

  echo "${name} 启动超时: ${url}" >&2
  return 1
}

wait_for_port() {
  local port="$1"
  local name="$2"
  local retries="${3:-40}"

  for ((i = 1; i <= retries; i += 1)); do
    if lsof -i "tcp:${port}" >/dev/null 2>&1; then
      echo "${name} 已监听端口 ${port}"
      return 0
    fi
    sleep 1
  done

  echo "${name} 启动超时，端口未监听: ${port}" >&2
  return 1
}

start_detached() {
  local workdir="$1"
  local log_file="$2"
  local pid_file="$3"
  local command="$4"

  (
    cd "${workdir}"
    nohup bash -lc "${command}" >"${log_file}" 2>&1 </dev/null &
    echo $! > "${pid_file}"
  )
}

start_backend() {
  local log_file="${LOG_DIR}/kimi-backend.log"
  echo "启动后端..."
  start_detached \
    "${APP_DIR}" \
    "${log_file}" \
    "${LOG_DIR}/kimi-backend.pid" \
    "KNOWLEDGE_BASE_PROVIDER='${KNOWLEDGE_BASE_PROVIDER}' WIKIMG_ROOT='${WIKIMG_ROOT}' WIKIMG_PROFILE='${WIKIMG_PROFILE}' PYTHON_BIN='${PYTHON_BIN}' PORT='${BACKEND_PORT}' bash ./start-wikimg-backend.sh"
  wait_for_http "http://localhost:${BACKEND_PORT}/api/health" "后端"
}

start_frontend() {
  local log_file="${LOG_DIR}/kimi-frontend.log"
  echo "启动前端..."
  start_detached \
    "${APP_DIR}" \
    "${log_file}" \
    "${LOG_DIR}/kimi-frontend.pid" \
    "npm run dev -- --host 0.0.0.0 --port '${FRONTEND_PORT}'"
  wait_for_port "${FRONTEND_PORT}" "前端"
}

stop_qagent_gateway() {
  if [[ ! -d "${QAGENT_DIR}" ]]; then
    return
  fi

  echo "关闭旧的 QAgent web runtime gateway..."
  (
    cd "${QAGENT_DIR}"
    node ./bin/qagent.js --cwd "${WEB_RUNTIME_DIR}" gateway stop >/dev/null 2>&1 || true
  )
}

print_summary() {
  cat <<EOF

启动完成
  前端: http://localhost:${FRONTEND_PORT}
  后端健康检查: http://localhost:${BACKEND_PORT}/api/health

日志文件
  前端: ${LOG_DIR}/kimi-frontend.log
  后端: ${LOG_DIR}/kimi-backend.log

常用命令
  查看前端日志: tail -f "${LOG_DIR}/kimi-frontend.log"
  查看后端日志: tail -f "${LOG_DIR}/kimi-backend.log"
EOF
}

require_cmd npm
require_cmd node
require_cmd curl
require_cmd lsof

if [[ ! -d "${APP_DIR}/node_modules" ]]; then
  echo "缺少依赖目录: ${APP_DIR}/node_modules" >&2
  echo "请先在 ${APP_DIR} 下执行 npm ci" >&2
  exit 1
fi

echo "关闭旧进程..."
stop_qagent_gateway
stop_port "${BACKEND_PORT}"
stop_port "${FRONTEND_PORT}"
start_backend
start_frontend
print_summary
