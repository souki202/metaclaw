import { NextResponse } from 'next/server';
import { getSessionManagerSafe, getConfigSafe, handleError, badRequest } from '../../helpers';
import { saveConfig } from '../../../../src/config';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const orders: { id: string; order: number; }[] = body.orders;

        if (!Array.isArray(orders) || orders.length === 0) {
            return badRequest('orders must be a non-empty array');
        }

        const config = getConfigSafe();
        const sessions = getSessionManagerSafe();
        const configs = sessions.getSessionConfigs();

        // Validate all session IDs exist
        for (const item of orders) {
            if (!configs[item.id]) {
                return badRequest(`Session not found: ${item.id}`);
            }
        }

        // Validate all sessions belong to the same organization (no cross-org reordering)
        const orgs = new Set(orders.map((item) => configs[item.id]?.organizationId ?? 'default'));
        if (orgs.size > 1) {
            return badRequest('Cannot reorder sessions across organizations');
        }

        // Apply order values
        for (const item of orders) {
            config.sessions[item.id] = {
                ...config.sessions[item.id],
                order: item.order,
            };
        }

        saveConfig(config);

        return NextResponse.json({ ok: true });
    } catch (error) {
        return handleError(error);
    }
}
