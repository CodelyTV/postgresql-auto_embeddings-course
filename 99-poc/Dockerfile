FROM pgvector/pgvector:0.8.0-pg16

# Install build dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    postgresql-server-dev-16 \
    && rm -rf /var/lib/apt/lists/*

# Clone and install pgmq
RUN git clone https://github.com/tembo-io/pgmq.git /pgmq \
    && cd /pgmq/pgmq-extension \
    && make \
    && make install install-pg-partman

# Install pg_net extension
RUN cd /tmp \
    && git clone https://github.com/supabase/pg_net.git \
    && cd pg_net \
    && make \
    && make install

# Install halfvec extension
RUN cd /tmp \
    && git clone https://github.com/neondatabase/halfvec.git \
    && cd halfvec \
    && make \
    && make install

# Install other extensions
RUN apt-get update && apt-get install -y \
    postgresql-16-cron \
    && rm -rf /var/lib/apt/lists/*
