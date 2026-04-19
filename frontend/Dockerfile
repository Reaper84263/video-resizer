FROM python:3.13-slim

WORKDIR /site
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY index.html ./index.html
COPY styles.css ./styles.css
COPY script.js ./script.js
COPY config.js ./config.js

EXPOSE 8080

CMD ["python", "-m", "http.server", "8080", "--bind", "0.0.0.0"]
