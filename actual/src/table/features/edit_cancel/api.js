export const editCancelApi = Object.freeze({
  featureId: 'table.edit.cancel',
  controls: [
    { id: 'key.escape', type: 'key', description: 'Cancel current cell editor without committing' }
  ],
  eventsIn: ['edit.cancel'],
  commandsOut: ['editor.close', 'focus.restore']
});
