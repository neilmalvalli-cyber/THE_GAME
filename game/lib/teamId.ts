/** Short, readable team tag: server team ids are UUIDs, mock ids are already short. */
export const teamTag = (id: string) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? `TEAM-${id.slice(0, 6).toUpperCase()}` : id);
