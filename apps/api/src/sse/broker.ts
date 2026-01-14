import { Response } from 'express';
import { logger } from '../logger.js';

interface Client {
  id: string;
  res: Response;
  channel: string;
  type: 'overlay' | 'dashboard';
}

const clients: Map<string, Client> = new Map();
let clientIdCounter = 0;

export function addClient(res: Response, channel: string, type: 'overlay' | 'dashboard'): string {
  const id = `client_${++clientIdCounter}`;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  clients.set(id, { id, res, channel, type });

  logger.info(`SSE client connected: ${id} (channel: ${channel}, type: ${type})`);

  // Send initial connection message
  res.write(`:connected\n\n`);

  // Setup keepalive
  const keepaliveInterval = setInterval(() => {
    if (!res.writable) {
      clearInterval(keepaliveInterval);
      return;
    }
    res.write(`:keepalive\n\n`);
  }, 15000);

  // Handle disconnect
  res.on('close', () => {
    clearInterval(keepaliveInterval);
    clients.delete(id);
    logger.info(`SSE client disconnected: ${id}`);
  });

  return id;
}

export function removeClient(id: string): void {
  const client = clients.get(id);
  if (client) {
    clients.delete(id);
    logger.info(`SSE client removed: ${id}`);
  }
}

export function broadcast(
  channel: string,
  eventName: string,
  data: unknown,
  targetType?: 'overlay' | 'dashboard'
): void {
  const json = JSON.stringify(data);
  const message = `event: ${eventName}\ndata: ${json}\n\n`;

  let count = 0;
  for (const client of clients.values()) {
    if (client.channel !== channel) continue;
    if (targetType && client.type !== targetType) continue;
    if (!client.res.writable) continue;

    client.res.write(message);
    count++;
  }

  logger.debug(`Broadcast ${eventName} to ${count} clients on channel ${channel}`, data);
}

export function broadcastToOverlay(channel: string, eventName: string, data: unknown): void {
  broadcast(channel, eventName, data, 'overlay');
}

export function broadcastToDashboard(channel: string, eventName: string, data: unknown): void {
  broadcast(channel, eventName, data, 'dashboard');
}

export function broadcastToAll(channel: string, eventName: string, data: unknown): void {
  broadcast(channel, eventName, data);
}

export function getClientCount(channel: string): { overlay: number; dashboard: number } {
  let overlay = 0;
  let dashboard = 0;
  for (const client of clients.values()) {
    if (client.channel !== channel) continue;
    if (client.type === 'overlay') overlay++;
    else dashboard++;
  }
  return { overlay, dashboard };
}
