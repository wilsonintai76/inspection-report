/*
 * main.jsx - the entry point.
 *
 * Mounting is deliberately bare: everything the page knows lives in the provider, and
 * everything it shows is a component below it. There is no module-level mutable application
 * state and no render() to remember to call - the two things that let the old single-file
 * version disagree with itself.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './state/AppProvider';
import App from './App';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('Elemen #root tiada dalam halaman.');

/*
 * Mounted SYNCHRONOUSLY, on purpose.
 *
 * A normal `root.render()` is asynchronous, so a script placed after this one would run
 * before the application had rendered anything - and before window.__uiHarness__ existed.
 * The verification harnesses are exactly that script: they are appended right after the
 * application and expect to be able to read the rendered page immediately.
 *
 * flushSync makes the first render commit before this statement returns, which keeps the
 * page's contract with those harnesses - and means the very first paint is not one frame
 * later than it needs to be.
 */
flushSync(() => {
  createRoot(host).render(
    <AppProvider>
      <App />
    </AppProvider>,
  );
});
