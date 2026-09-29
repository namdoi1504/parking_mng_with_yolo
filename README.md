
## Setup (Python 3.11+)

Run from `backend` with a working Python environment:

```powershell
python -m pip install -r requirements-dev.txt

python -m alembic upgrade head
python -m app.seed --admin-username admin  # lệnh tạo tài khoản đừng có hỏi anh anh ngủ rồi
python -m uvicorn app.main:app --reload
```
