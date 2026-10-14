"""Identity of this backend lifetime; persisted observations need a fresh confirmation."""
from uuid import uuid4

backend_id = str(uuid4())


def restart():
    global backend_id
    backend_id = str(uuid4())
