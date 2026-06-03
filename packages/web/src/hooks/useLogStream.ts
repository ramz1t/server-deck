import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/axios'

async function fetchLogs(containerId: string): Promise<string[]> {
  const { data } = await api.get<{ lines: string[] }>(`/containers/${containerId}/logs`)
  return data.lines
}

export function useContainerLogs(containerId: string) {
  return useQuery({
    queryKey: ['container-logs', containerId],
    queryFn: () => fetchLogs(containerId),
    enabled: !!containerId,
    staleTime: 0,
  })
}
