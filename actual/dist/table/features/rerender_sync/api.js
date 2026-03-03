export const rerenderSyncApi = Object.freeze({
  featureId: 'table.rerender.sync',
  controls: [
    { id: 'table.rerender.request', type: 'system', description: 'Request table rerender from store changes' }
  ],
  eventsIn: ['rerender.sync'],
  commandsOut: ['renderer.apply', 'scroll.anchor']
});
