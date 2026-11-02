FROM python:3.11.9-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# CPU build: no NVIDIA driver required on the receiving machine.
RUN pip install --no-cache-dir torch==2.9.1 torchvision==0.24.1 \
    --index-url https://download.pytorch.org/whl/cpu
COPY AI/requirements-docker.txt ./requirements-ai.txt
RUN pip install --no-cache-dir -r requirements-ai.txt && pip check

RUN mkdir -p /tmp/ultralytics
COPY AI/datasets/*.py ./AI/datasets/

CMD ["python", "-u", "AI/datasets/parking_agent.py", "--stream", "--no-window"]
