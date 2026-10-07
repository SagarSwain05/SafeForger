# SafeForge Vision API / edge agent. Build from the repository root:
#   docker build -f cv-service/Dockerfile -t safeforge-vision .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY cv-service/requirements.txt cv-service/requirements.txt
RUN pip install --no-cache-dir -r cv-service/requirements.txt
COPY models models
COPY samples samples
COPY backend/src/data/plant-layout.json backend/src/data/plant-layout.json
COPY cv-service cv-service
WORKDIR /app/cv-service
EXPOSE 8000
# Default: HTTP inference API. Override CMD to run the streaming agent, e.g.
#   docker run -e SAFEFORGE_BACKEND_URL=… safeforge-vision python main.py --source rtsp://… --camera CAM-03
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
