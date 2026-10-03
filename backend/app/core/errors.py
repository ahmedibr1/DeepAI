from fastapi import HTTPException, status


def forbidden(detail: str = "You do not have permission to do this.") -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail)


def not_found(what: str = "Resource") -> HTTPException:
    # Used for records the caller may not see as well, so existence is not disclosed.
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found.")


def conflict(detail: str, **extra) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, {"message": detail, **extra})


def unprocessable(detail: str, **extra) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"message": detail, **extra})
