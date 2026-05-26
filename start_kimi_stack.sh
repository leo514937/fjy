#!/usr/bin/env bash

set -euo pipefail

# 获取脚本所在目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT_DIR}/kimi-agent-knowledge-base-collab/app"
XIAOGUGIT_DIR="${ROOT_DIR}/OntoGit/xiaogugit"
PROBABILITY_DIR="${ROOT_DIR}/OntoGit/probability"
GATEWAY_DIR="${ROOT_DIR}/OntoGit/gateway"
WIKIMG_ROOT_DIR="${ROOT_DIR}/Ontology_Factory"
LOG_DIR="${ROOT_DIR}/.run-logs"

# 配置参数
BACKEND_PORT="${PORT:-8787}"
FRONTEND_PORT="${VITE_PORT:-5173}"
XIAOGUGIT_PORT=8001
PROBABILITY_PORT=5001
GATEWAY_PORT=8080
ONTOGIT_GATEWAY_URL="${ONTOGIT_GATEWAY_URL:-http://81.70.12.214:8080}"
USE_REMOTE_ONTOGIT="${USE_REMOTE_ONTOGIT:-auto}"

find_python() {
  for cmd in python python3 py; do
    if command -v "$cmd" >/dev/null 2>&1; then
      # 在 Windows 上，检查是否为微软商店的占位符
      if "$cmd" --version >/dev/null 2>&1; then
        echo "$cmd"
        return 0
      fi
    fi
  done
  echo "python" # 默认回退
}

PYTHON_BIN_DETECTED="$(find_python)"
PYTHON_BIN="${PYTHON_BIN:-$PYTHON_BIN_DETECTED}"
WIKIMG_ROOT="${WIKIMG_ROOT:-${WIKIMG_ROOT_DIR}}"
KNOWLEDGE_DATA_ROOT="${KNOWLEDGE_DATA_ROOT:-${ROOT_DIR}/knowledge-data}"
ONTOGIT_STORAGE_ROOT="${ONTOGIT_STORAGE_ROOT:-${KNOWLEDGE_DATA_ROOT}/store}"
WIKIMG_PROFILE="${WIKIMG_PROFILE:-kimi}"

# 认证配置
GATEWAY_SERVICE_API_KEY="${GATEWAY_SERVICE_API_KEY:-xgk_79689a3af4225035d2de7551ff1b2b69070636b2fbb12205}"
XG_AUTH_SECRET="${XG_AUTH_SECRET:-xiaogugit-auth-secret}"
XG_AUTH_USERNAME="${XG_AUTH_USERNAME:-mogong}"
XG_AUTH_PASSWORD="${XG_AUTH_PASSWORD:-123456}"

# OpenRouter / DMXAPI 配置（kimi 默认优先 OpenRouter）
DMXAPI_API_KEY="${DMXAPI_API_KEY:-${OPENROUTER_API_KEY:-}}"
DMXAPI_BASE_URL="${DMXAPI_BASE_URL:-${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}}"
DMXAPI_MODEL="${DMXAPI_MODEL:-${OPENROUTER_MODEL:-openai/gpt-4o-mini}}"

mkdir -p "${LOG_DIR}"

LOCAL_ONTOGIT_AVAILABLE=false
if [[ -d "${XIAOGUGIT_DIR}" && -d "${PROBABILITY_DIR}" && -d "${GATEWAY_DIR}" ]]; then
  LOCAL_ONTOGIT_AVAILABLE=true
fi

REMOTE_ONTOGIT_ONLY=false
case "${USE_REMOTE_ONTOGIT}" in
  auto)
    if [[ "${LOCAL_ONTOGIT_AVAILABLE}" != true ]]; then
      REMOTE_ONTOGIT_ONLY=true
    fi
    ;;
  1|true|TRUE|yes|YES|remote|REMOTE)
    REMOTE_ONTOGIT_ONLY=true
    ;;
  0|false|FALSE|no|NO|local|LOCAL)
    REMOTE_ONTOGIT_ONLY=false
    ;;
  *)
    echo "USE_REMOTE_ONTOGIT 仅支持 auto|true|false，当前值: ${USE_REMOTE_ONTOGIT}" >&2
    exit 1
    ;;
esac

if [[ "${REMOTE_ONTOGIT_ONLY}" != true && "${LOCAL_ONTOGIT_AVAILABLE}" != true ]]; then
  echo "缺少本地 OntoGit 目录，无法启用本地模式。请改用 USE_REMOTE_ONTOGIT=true 或恢复 OntoGit 目录。" >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

find_listening_pids() {
  local port="$1"

  if has_cmd lsof; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
    return 0
  fi

  if has_cmd netstat; then
    # Windows 环境下的 netstat 输出处理
    # 查找本地地址列中包含 :port 的行，并提取最后的 PID 列
    netstat -ano | grep -E " (0\.0\.0\.0|127\.0\.0\.1|\[::\]):${port} " | grep "LISTENING" | awk '{print $5}' | sort -u || true
    return 0
  fi

  return 1
}

kill_pids() {
  local signal="$1"
  shift

  local is_windows=false
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    is_windows=true
  fi

  if [[ -z "${signal}" ]]; then
    for pid in "$@"; do
      if [[ "$is_windows" == "true" ]]; then
        taskkill.exe /PID "$pid" /F /T >/dev/null 2>&1 || true
      else
        kill "$pid" 2>/dev/null || true
      fi
    done
    return 0
  fi

  if [[ "$signal" == "-9" ]]; then
    for pid in "$@"; do
      if [[ "$is_windows" == "true" ]]; then
        taskkill.exe /PID "$pid" /T /F >/dev/null 2>&1 || true
      else
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
    return 0
  fi

  for pid in "$@"; do
    kill "$signal" "$pid" 2>/dev/null || true
  done
}

function stop_port() {
  local port="$1"
  local name="$2"
  local pids
  
  # 在 Windows 上尝试使用 taskkill 直接按端口查杀（如果 netstat 可用）
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    local win_pids=$(netstat -ano | grep -E ":${port}\s+.*LISTENING" | awk '{print $5}' | sort -u)
    if [[ -n "${win_pids}" ]]; then
      echo "发现端口 ${port} (${name}) 的 Windows 进程: ${win_pids}"
      for wp in ${win_pids}; do
        taskkill.exe /PID "$wp" /F /T >/dev/null 2>&1 || true
      done
    fi
  fi

  pids="$(find_listening_pids "${port}" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [[ -z "${pids}" ]]; then
    return
  fi

  echo "关闭占用端口 ${port} (${name}) 的旧进程: ${pids}"
  kill_pids "" ${pids}
  sleep 1

  pids="$(find_listening_pids "${port}" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [[ -n "${pids}" ]]; then
    echo "强制结束仍占用端口 ${port} (${name}) 的进程: ${pids}"
    kill_pids -9 ${pids}
  fi
}

stop_pid_file() {
  local pid_file="$1"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid=$(cat "${pid_file}")
    if [[ -n "${pid}" ]]; then
      echo "停止 PID 文件中的进程: ${pid} (${pid_file})"
      kill_pids "${pid}" || true
      sleep 0.5
      kill_pids -9 "${pid}" || true
    fi
    rm -f "${pid_file}"
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local retries="${3:-60}"

  echo "等待 ${name} 就绪: ${url} ..."
  for ((i = 1; i <= retries; i += 1)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "  ${name} 已就绪"
      return 0
    fi
    if (( i % 10 == 0 )); then
      echo "  ... 仍在等待 ${name} ($i/$retries)"
    fi
    sleep 1
  done

  echo "${name} 启动超时: ${url}" >&2
  return 1
}

wait_for_port() {
  local port="$1"
  local name="$2"
  local retries="${3:-60}"

  for ((i = 1; i <= retries; i += 1)); do
    if [[ -n "$(find_listening_pids "${port}")" ]]; then
      echo "${name} 已监听端口 ${port}"
      return 0
    fi
    sleep 1
  done

  echo "${name} 启动超时，端口未监听: ${port}" >&2
  return 1
}

function start_detached() {
  local workdir="$1"
  local log_file="$2"
  local pid_file="$3"
  local env_vars="$4"
  local command="$5"

  (
    cd "${workdir}"
    # 使用 exec 确保 PID 文件记录的是真正的服务进程，而不是 Bash 壳
    nohup bash -c "${env_vars} exec ${command}" >"${log_file}" 2>&1 </dev/null &
    local pid=$!
    echo $pid > "${pid_file}"
    # 稍微等待确保进程没立即退出
    sleep 0.5
    if ! kill -0 $pid 2>/dev/null; then
       echo "警告: 进程 $pid 启动后似乎立即退出了，请检查日志 ${log_file}"
    fi
  )
}

start_ontogit_services() {
  if [[ "${REMOTE_ONTOGIT_ONLY}" == true ]]; then
    echo "检测到远端 OntoGit 模式，跳过本地 xiaogugit / probability / gateway 启动。"
    return
  fi

  echo "启动 xiaogugit..."
  start_detached \
    "${XIAOGUGIT_DIR}" \
    "${LOG_DIR}/xiaogugit.log" \
    "${LOG_DIR}/xiaogugit.pid" \
    "XG_ENV=development XG_HOST=0.0.0.0 XG_PORT=${XIAOGUGIT_PORT} XG_RELOAD=false XG_SERVICE_API_KEY='${GATEWAY_SERVICE_API_KEY}' XG_API_KEY='${GATEWAY_SERVICE_API_KEY}' XG_AUTH_SECRET='${XG_AUTH_SECRET}' XG_AUTH_USERNAME='${XG_AUTH_USERNAME}' XG_AUTH_PASSWORD='${XG_AUTH_PASSWORD}' XG_INFERENCE_URL='http://127.0.0.1:${PROBABILITY_PORT}/api/llm/probability-reason'" \
    "${PYTHON_BIN} ./server.py"

  echo "启动 probability..."
  start_detached \
    "${PROBABILITY_DIR}" \
    "${LOG_DIR}/probability.log" \
    "${LOG_DIR}/probability.pid" \
    "PROBABILITY_ENV=development HOST=0.0.0.0 PORT=${PROBABILITY_PORT} UVICORN_RELOAD=false XIAOGUGIT_BASE_URL='http://127.0.0.1:${XIAOGUGIT_PORT}' XIAOGUGIT_API_KEY='${GATEWAY_SERVICE_API_KEY}' GATEWAY_SERVICE_API_KEY='${GATEWAY_SERVICE_API_KEY}' GATEWAY_XG_AUTH_SECRET='${XG_AUTH_SECRET}' GATEWAY_XG_AUTH_USERNAME='${XG_AUTH_USERNAME}' DMXAPI_API_KEY='${DMXAPI_API_KEY}' DMXAPI_BASE_URL='${DMXAPI_BASE_URL}' DMXAPI_MODEL='${DMXAPI_MODEL}'" \
    "${PYTHON_BIN} ./app/main.py"

  wait_for_http "http://127.0.0.1:${XIAOGUGIT_PORT}/health" "xiaogugit"
  wait_for_http "http://127.0.0.1:${PROBABILITY_PORT}/health" "probability"

  echo "启动 OntoGit gateway..."
  local gateway_env="GATEWAY_XIAOGUGIT_URL='http://127.0.0.1:${XIAOGUGIT_PORT}' GATEWAY_PROBABILITY_URL='http://127.0.0.1:${PROBABILITY_PORT}' GATEWAY_XG_AUTH_SECRET='${XG_AUTH_SECRET}' GATEWAY_XG_AUTH_USERNAME='${XG_AUTH_USERNAME}' GATEWAY_SERVICE_API_KEY='${GATEWAY_SERVICE_API_KEY}'"
  
  if [[ -f "${GATEWAY_DIR}/gateway.exe" && -x "${GATEWAY_DIR}/gateway.exe" ]]; then
    start_detached "${GATEWAY_DIR}" "${LOG_DIR}/ontogit-gateway.log" "${LOG_DIR}/ontogit-gateway.pid" "${gateway_env}" "./gateway.exe"
  elif has_cmd go; then
    echo "gateway.exe 不可执行，改用 go run 启动 gateway..."
    start_detached "${GATEWAY_DIR}" "${LOG_DIR}/ontogit-gateway.log" "${LOG_DIR}/ontogit-gateway.pid" "${gateway_env}" "go run ."
  else
    echo "警告: 未找到 gateway.exe 或 go 命令，无法启动 OntoGit gateway。"
  fi
  
  if [[ -f "${LOG_DIR}/ontogit-gateway.pid" ]]; then
    wait_for_http "http://127.0.0.1:${GATEWAY_PORT}/health" "OntoGit gateway"
  fi

  ONTOGIT_GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}"
}

start_backend() {
  echo "启动 Kimi 后端..."
  start_detached \
    "${APP_DIR}" \
    "${LOG_DIR}/kimi-backend.log" \
    "${LOG_DIR}/kimi-backend.pid" \
    "WIKIMG_ROOT='${WIKIMG_ROOT}' KNOWLEDGE_DATA_ROOT='${KNOWLEDGE_DATA_ROOT}' WIKIMG_PROFILE='${WIKIMG_PROFILE}' ONTOGIT_STORAGE_ROOT='${ONTOGIT_STORAGE_ROOT}' WIKIMG_ONTOGIT_STORAGE_ROOT='${ONTOGIT_STORAGE_ROOT}' WIKIMG_ONTOGIT_GATEWAY_URL='${ONTOGIT_GATEWAY_URL}' XG_GATEWAY_URL='${ONTOGIT_GATEWAY_URL}' GATEWAY_URL='${ONTOGIT_GATEWAY_URL}' PYTHON_BIN='${PYTHON_BIN}' PORT='${BACKEND_PORT}'" \
    "node ./server.mjs"
  wait_for_http "http://127.0.0.1:${BACKEND_PORT}/api/health" "后端"
}

start_frontend() {
  echo "启动 Vite 前端..."
  start_detached \
    "${APP_DIR}" \
    "${LOG_DIR}/kimi-frontend.log" \
    "${LOG_DIR}/kimi-frontend.pid" \
    "" \
    "npm run dev -- --host 0.0.0.0 --port '${FRONTEND_PORT}'"
  wait_for_port "${FRONTEND_PORT}" "前端"
}

print_summary() {
  local ontogit_summary=""
  local ontogit_logs=""
  if [[ "${REMOTE_ONTOGIT_ONLY}" == true ]]; then
    ontogit_summary="  OntoGit gateway(远端): ${ONTOGIT_GATEWAY_URL}"
    ontogit_logs='  OntoGit 由远端提供，本地未启动 xiaogugit / probability / gateway'
  else
    ontogit_summary=$'  xiaogugit: http://127.0.0.1:'"${XIAOGUGIT_PORT}"$'/health\n  probability: http://127.0.0.1:'"${PROBABILITY_PORT}"$'/health\n  OntoGit gateway: http://127.0.0.1:'"${GATEWAY_PORT}"$'/health'
    ontogit_logs=$'  xiaogugit: '"${LOG_DIR}"$'/xiaogugit.log\n  probability: '"${LOG_DIR}"$'/probability.log\n  gateway: '"${LOG_DIR}"$'/ontogit-gateway.log'
  fi

  cat <<EOF

启动完成
  前端: http://127.0.0.1:${FRONTEND_PORT}
  后端: http://127.0.0.1:${BACKEND_PORT}/api/health
${ontogit_summary}

日志文件
  前端: ${LOG_DIR}/kimi-frontend.log
  后端: ${LOG_DIR}/kimi-backend.log
${ontogit_logs}

常用命令
  查看前端日志: tail -f "${LOG_DIR}/kimi-frontend.log"
  查看后端日志: tail -f "${LOG_DIR}/kimi-backend.log"
EOF
}

# 检查基础命令
require_cmd npm
require_cmd node
require_cmd curl
if ! has_cmd lsof && ! has_cmd netstat; then
  echo "缺少端口检测命令: lsof 或 netstat" >&2
  exit 1
fi

# 检查环境
if [[ ! -d "${APP_DIR}/node_modules" ]]; then
  echo "缺少依赖目录: ${APP_DIR}/node_modules" >&2
  echo "请先在 ${APP_DIR} 下执行 npm ci" >&2
  exit 1
fi

echo "关闭旧进程..."
stop_pid_file "${LOG_DIR}/kimi-backend.pid"
stop_pid_file "${LOG_DIR}/kimi-frontend.pid"

stop_port "${BACKEND_PORT}" "后端"
stop_port "${FRONTEND_PORT}" "前端"
if [[ "${REMOTE_ONTOGIT_ONLY}" != true ]]; then
  stop_pid_file "${LOG_DIR}/xiaogugit.pid"
  stop_pid_file "${LOG_DIR}/probability.pid"
  stop_pid_file "${LOG_DIR}/ontogit-gateway.pid"
  stop_port "${XIAOGUGIT_PORT}" "xiaogugit"
  stop_port "${PROBABILITY_PORT}" "probability"
  stop_port "${GATEWAY_PORT}" "gateway"
fi

# 依次启动服务
start_ontogit_services
start_backend
start_frontend

print_summary
