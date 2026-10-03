FROM python:3.12-slim
RUN pip install --no-cache-dir pyarrow==25.0.1 numpy==2.4.6
WORKDIR /app
COPY index.html ./
COPY vendor/ vendor/
COPY tools/cube_bridge.py tools/market_state_reader.py tools/
USER 65534:65534
CMD ["python", "tools/cube_bridge.py", "--port", "8487"]
