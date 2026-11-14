# hot-base: Pre-baked development environment base image
# Contains all toolchains and core tools. Rebuilt rarely (~weekly).
# Usage: docker build -t hot-base .

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Core system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    wget \
    git \
    jq \
    unzip \
    ca-certificates \
    gnupg \
    lsb-release \
    sudo \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Go toolchain
RUN curl -fsSL https://go.dev/dl/go1.26.6.linux-amd64.tar.gz | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/root/go"
ENV PATH="${GOPATH}/bin:${PATH}"

# Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Ruby
RUN apt-get update && apt-get install -y --no-install-recommends \
    ruby \
    ruby-dev \
    && rm -rf /var/lib/apt/lists/*

# mise (tool version manager)
RUN curl https://mise.run | sh \
    && echo 'eval "$(/root/.local/bin/mise activate bash)"' >> /root/.bashrc
ENV PATH="/root/.local/bin:${PATH}"

# uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Bitwarden CLI
RUN npm install -g @bitwarden/cli

# Database clients
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

# ZCode Source Server (optional, for remote development)
# RUN ... (install ZCode server)

# Create /code directory
RUN mkdir -p /code

# Set working directory
WORKDIR /code

# Default command
CMD ["/bin/bash"]
