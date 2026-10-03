"""Create the first Admin account (idempotent). Run once after migrations:

    PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin PORTAL_BOOTSTRAP_ADMIN_PASSWORD=... python -m scripts.bootstrap_admin
"""
import os
import sys

from sqlalchemy import func, select

from app.core.security import hash_password, password_problems
from app.db import SessionLocal
from app.models import Role, User
from app.services import audit


def main() -> int:
    username = os.environ.get("PORTAL_BOOTSTRAP_ADMIN_USERNAME", "admin")
    password = os.environ.get("PORTAL_BOOTSTRAP_ADMIN_PASSWORD")
    if not password:
        print("Set PORTAL_BOOTSTRAP_ADMIN_PASSWORD.", file=sys.stderr)
        return 2
    if problems := password_problems(password):
        print("Password policy: " + " ".join(problems), file=sys.stderr)
        return 2
    with SessionLocal() as db:
        if db.execute(select(User).where(func.lower(User.username) == username.lower())).first():
            print(f"User '{username}' already exists; nothing to do.")
            return 0
        role = db.execute(select(Role).where(Role.key == "admin")).scalar_one()
        user = User(username=username, full_name="Portal Administrator", role_id=role.id,
                    password_hash=hash_password(password), must_change_password=True)
        db.add(user)
        db.flush()
        audit.record(db, "user.created", actor_username="bootstrap", entity_type="user", entity_id=user.id,
                     details={"username": username, "role": "admin", "source": "bootstrap"})
        db.commit()
        print(f"Admin '{username}' created. They must change the password at first sign-in.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
