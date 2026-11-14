import { useEffect, useState, useCallback } from 'react';
import { Intakelet } from '@alvarovillalbaa/intakelet/react';
import { createIndexedDBHost } from '@alvarovillalbaa/intakelet/element';
import '@alvarovillalbaa/intakelet/styles.css';

export function LocalOnboarding({ workspaceId }) {
  const [connection, setConnection] = useState(null);
  useEffect(() => {
    const host = createIndexedDBHost({ workspaceId, databaseName: 'intakelet-example-v1' });
    setConnection({ workspaceId, host });
    return () => host.close();
  }, [workspaceId]);
  const onCommit = useCallback(receipt => { console.info('Onboarding revision', receipt.revision); }, []);
  if (connection?.workspaceId !== workspaceId) return <p>Loading onboarding…</p>;
  return <Intakelet workspaceId={workspaceId} host={connection.host} onCommit={onCommit} />;
}
