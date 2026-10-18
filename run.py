import os

import uvicorn

from career_twin.shared.core.config import ROOT  # Loads only this project's .env; preserves external variables.


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("APP_HOST", "0.0.0.0" if "PORT" in os.environ else "127.0.0.1"),
        port=int(os.getenv("PORT", os.getenv("APP_PORT", "8000"))),
        app_dir=str(ROOT),
        proxy_headers=True,
        forwarded_allow_ips="*" if os.getenv("K_SERVICE") else "127.0.0.1",
        access_log=False,
        log_level="info",
    )
