// Client entry (was main.tsx under Vite). Loaded by app/[[...slug]]/client.tsx with ssr: false.
import { App } from './App';

export function Boot() {
  return <App />;
}
