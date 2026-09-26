#!/usr/bin/env python3
"""
Main entry point for the patient journal backend.

This starts the FastAPI server for data processing and analysis.

Usage:
    uvicorn analysis.main:app --reload --port 8000

Or run directly:
    python -m analysis.main
"""

import logging
import uvicorn

from .api import app

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


if __name__ == "__main__":
    logger.info("Starting Patient Journal Backend...")
    logger.info("API documentation available at http://localhost:8000/docs")
    logger.info("Endpoints:")
    logger.info("  POST /wearable    - Ingest wearable data")
    logger.info("  POST /interview   - Ingest interview data")
    logger.info("  GET  /alerts      - Get all alerts")
    logger.info("  GET  /health      - Health check")
    uvicorn.run(
        "analysis.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
