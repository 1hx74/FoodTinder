"""Ошибки в формате контракта {"code": N, "state": "..."}.

Используются в эндпоинтах регистрации/восстановления пароля с кодом с почты.
Остальные эндпоинты auth пока отдают ошибки как раньше (HTTPException -> {"detail"}).
"""
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, code: int, state: str):
        super().__init__(f"{code} {state}")
        self.code = code
        self.state = state

    def to_response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.code, content={"code": self.code, "state": self.state}
        )
