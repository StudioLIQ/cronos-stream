export type SSEEventHandler = (event: string, data: unknown) => void;

export function connectSSE(url: string, onEvent: SSEEventHandler): EventSource {
  const eventSource = new EventSource(url);

  eventSource.onopen = () => {
    console.log('SSE connected:', url);
  };

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent('message', data);
    } catch {
      // Ignore non-JSON messages (like keepalives)
    }
  };

  // Listen for named events
  const eventTypes = [
    'effect.triggered',
    'donation.received',
    'qa.created',
    'qa.show',
    'qa.updated',
  ];

  for (const eventType of eventTypes) {
    eventSource.addEventListener(eventType, (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        onEvent(eventType, data);
      } catch (err) {
        console.error(`Failed to parse ${eventType} event:`, err);
      }
    });
  }

  return eventSource;
}
