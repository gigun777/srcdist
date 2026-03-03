export const editCommitApi = Object.freeze({
  featureId: 'table.edit.commit',
  controls: [
    { id: 'cell.click', type: 'ui-event', description: 'Activate editor for table cell' },
    { id: 'key.enter', type: 'key', description: 'Commit current cell value' }
  ],
  eventsIn: ['edit.commit'],
  commandsOut: ['setCell', 'requestRerender', 'setActiveCell']
});
