import asyncio
import json
from unittest.mock import AsyncMock, Mock

from app.websocket_manager import ConnectionManager


def test_large_batch_checks_permissions_once_and_keeps_message_order():
    async def exercise():
        manager = ConnectionManager()
        socket = Mock(accept=AsyncMock(), send_text=AsyncMock(), close=AsyncMock())
        authorize = Mock(return_value=True)
        await manager.connect(socket, authorize=authorize)
        messages = [{"type": "SLOT_STATUS_CHANGED", "parking_slot_id": i} for i in range(470)]
        await manager.broadcast_many(messages)
        authorize.assert_called_once_with()
        assert [json.loads(call.args[0]) for call in socket.send_text.call_args_list] == messages

        # Permission revocation takes effect on the next update batch.
        authorize.return_value = False
        await manager.broadcast_many(messages)
        assert socket.send_text.await_count == 470
        socket.close.assert_awaited_once_with(code=1008)
        assert manager.connection_count == 0

    asyncio.run(exercise())


def test_slow_viewer_is_disconnected_without_blocking_healthy_viewer():
    async def exercise():
        manager = ConnectionManager(send_timeout_seconds=0.1)
        healthy_sent = asyncio.Event()

        async def blocked_send(text):
            await asyncio.Event().wait()

        async def healthy_send(text):
            healthy_sent.set()

        slow = Mock(accept=AsyncMock(), send_text=blocked_send, close=AsyncMock())
        healthy = Mock(accept=AsyncMock(), send_text=healthy_send, close=AsyncMock())
        await manager.connect(slow)
        await manager.connect(healthy)
        task = asyncio.create_task(manager.broadcast_many([{"type": "test"}]))
        await asyncio.wait_for(healthy_sent.wait(), timeout=1)
        assert not task.done()
        await asyncio.wait_for(task, timeout=1)
        assert manager.active_connections == [healthy]
        slow.close.assert_awaited_once_with(code=1011)

    asyncio.run(exercise())
