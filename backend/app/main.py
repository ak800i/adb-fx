"""
ADB File Explorer - FastAPI Backend

A REST API for managing files on Android devices via ADB.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import devices, files

# Create FastAPI application
app = FastAPI(
    title="ADB File Explorer API",
    description="REST API for managing files on Android devices via ADB",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative dev server
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include routers
app.include_router(devices.router, prefix="/api")
app.include_router(files.router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": "ADB File Explorer API",
        "version": "1.0.0",
        "docs": "/api/docs"
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
