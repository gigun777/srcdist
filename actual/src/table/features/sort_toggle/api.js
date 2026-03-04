export const sortToggleApi = Object.freeze({
  featureId: 'table.sort.toggle',
  controls: [
    { id: 'header.click', type: 'ui-event', description: 'Toggle sorting for a table column' }
  ],
  eventsIn: ['sort.toggle'],
  commandsOut: ['setSort', 'requestRerender']
});
