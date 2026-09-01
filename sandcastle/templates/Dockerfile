FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# node 官方镜像已占用 uid/gid 1000（node 用户）——移除后以 agent 复用该 UID，
# 与 podman({ containerUid: 1000, containerGid: 1000 }) 对齐（--userns=keep-id）。
RUN userdel -r node 2>/dev/null || true; groupdel node 2>/dev/null || true; \
    groupadd -g 1000 agent && useradd -m -u 1000 -g 1000 -s /bin/bash agent

# DSH CLI（钉版本；宿主 DSH 升级时重建镜像）
RUN npm i -g @deepseek-ai/dsh@0.1.1-rc.2

# —— Rust 项目在此追加工具链（按需取消注释）——
# RUN apt-get update && apt-get install -y --no-install-recommends \
#       build-essential pkg-config libssl-dev curl \
#    && rm -rf /var/lib/apt/lists/* \
#    && su agent -c 'curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal'

USER agent
WORKDIR /home/agent/workspace
