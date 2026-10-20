import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PageLayout } from './components/layout/PageLayout';
import { HomePage } from './pages/HomePage';
import { NewCheckPage } from './pages/NewCheckPage';
import { ResultsPage } from './pages/ResultsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  useEffect(() => {
    function blurNumberInputOnWheel(event: WheelEvent) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'number') {
        return;
      }
      target.blur();
    }

    document.addEventListener('wheel', blurNumberInputOnWheel, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener('wheel', blurNumberInputOnWheel, true);
  }, []);

  return (
    <BrowserRouter>
      <PageLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/check" element={<NewCheckPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </PageLayout>
    </BrowserRouter>
  );
}
