from fastapi import FastAPI, HTTPException, Response, Cookie
from fastapi.responses import FileResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions = {}


class LoginRequest(BaseModel):
    username: str
    password: str


@app.get("/")
def main():
    return FileResponse("main.html")


@app.get("/authentication")
def authentication():
    return FileResponse("authentication.html")


@app.post("/logout")
def logout(
    response: Response,
    session: str | None = Cookie(default=None)
):

    if session:
        sessions.pop(session, None)

    response.delete_cookie("session")

    return {
        "message": "Logged out"
    }

# to CND?
@app.get("/api.js")
def authentication():
    return FileResponse("api.js")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000
    )