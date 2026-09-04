# OSA (Open SolutionAssay) + OSP (Open ScholarPeer) 统一运行时
# 见 issue #3。宿主机状态与本镜像无关：所有版本在此 pin 死。
FROM node:22-bookworm-slim

# 版本 pin —— 改这里，不要改宿主机
ARG OPENCODE_VERSION=1.18.27
ARG OSP_REF=v2.2.0

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/root/.opencode/bin:/root/.local/bin:${PATH}"

# 系统依赖。poppler-utils 提供 pdftotext/pdfinfo —— OSP 硬依赖，osp doctor 会检查。
# python3-venv + ensurepip 是 OSP 每次 run 自建 MCP venv 所必需。
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git \
        poppler-utils \
        python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

# opencode —— OSA 与 OSP 共用的 agent runtime
RUN curl -fsSL https://opencode.ai/install | VERSION="${OPENCODE_VERSION}" bash

# OSP —— pin 到 release，走官方 installer。OSA 的 paper 轴以子进程委派它。
RUN curl -fsSL "https://raw.githubusercontent.com/a-green-hand-jack/open-scholar-peer/${OSP_REF}/install_cli.sh" | bash

# 沙箱侧 Python 依赖。清单来自对测试集 164 个 .py 的 import 统计：
# 标准库已覆盖多数（fractions 32 / unittest 36 / itertools 36 / hashlib 25），
# 第三方只有 numpy(18) 与 scipy(5)；networkx 是 p2113 的唯一 requirements.txt；
# pytest 是 p3535 的 pyproject 配置。不装 Mathematica —— lewton 按设计标 static。
RUN pip3 install --no-cache-dir --break-system-packages \
        numpy scipy "networkx==3.6.1" pytest sympy

# OSA 本体：TS CLI，从源码构建并全局安装为 `osa`。
# dev loop 下 bind-mount /src/osa 覆盖源码后由 entrypoint 增量重建。
WORKDIR /opt/osa
COPY package.json tsconfig.json ./
RUN npm install --ignore-scripts
COPY src/ ./src/
COPY prompts/ ./prompts/
RUN npm run build && chmod +x dist/cli.js && npm link

COPY docker/entrypoint.sh /usr/local/bin/osa-entrypoint
RUN chmod +x /usr/local/bin/osa-entrypoint
WORKDIR /src/osa

# 被审对象只读挂载于此；产出落 /runs
VOLUME ["/data/tasks", "/runs"]

ENTRYPOINT ["/usr/local/bin/osa-entrypoint"]
CMD ["--help"]
