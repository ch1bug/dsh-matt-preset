FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# node 官方镜像已占用 uid/gid 1000（node 用户）——移除后以 agent 复用该 UID，
# 与 podman({ containerUid: 1000, containerGid: 1000 }) 对齐（--userns=keep-id）。
RUN userdel -r node 2>/dev/null || true; groupdel node 2>/dev/null || true; \
    groupadd -g 1000 agent && useradd -m -u 1000 -g 1000 -s /bin/bash agent

# DSH CLI —— 版本经 ARG 注入。**单一事实源 = 本仓 package.json 的 version**
# （去 `-r<N>` 后缀即宿主锚：0.2.1-rc.2-r1 → 0.2.1-rc.2；口径见 docs/dev-environment.md §2 / ADR-0008）。
# 默认值必须等于派生锚 —— tests/verify-sandcastle-pins.mjs P1 钉住（**重锚时忘了改这里会红**，
# 而不是安静地装旧版本）。要覆盖版本，用构建包装器 sandcastle/templates/build-image.sh
# （它用 scripts/runtime-anchor.mjs 的同一条派生规则注入 --build-arg），或显式
# `podman build --build-arg DSH_VERSION=<官方版本> …`。
ARG DSH_VERSION=0.2.1-rc.2
RUN npm i -g @deepseek-ai/dsh@${DSH_VERSION}

# —— Rust 项目在此追加工具链（按需取消注释）——
# RUN apt-get update && apt-get install -y --no-install-recommends \
#       build-essential pkg-config libssl-dev curl \
#    && rm -rf /var/lib/apt/lists/* \
#    && su agent -c 'curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --profile minimal'

USER agent
WORKDIR /home/agent/workspace
