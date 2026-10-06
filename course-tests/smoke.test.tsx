import { act, render, waitFor } from '@testing-library/react-native';

import App from '../App';
import { setSessionLifecycleState } from '../src/features/session/application/sessionLifecycle';

jest.mock('../src/api/courseBackend', () => ({
  getBackendHealth: jest.fn().mockResolvedValue({
    ok: true,
    service: 'dmi-controlled-backend',
    contractVersion: 1,
  }),
}));

test('renders the reproducible baseline and resolves backend state', async () => {
  const view = await render(<App />);
  expect(view.getByText('CampusOps')).toBeTruthy();
  await waitFor(() => expect(view.getByTestId('backend-status').props.children.join('')).toContain('available'));
});

test('returns to the login view after the session expires', async () => {
  setSessionLifecycleState('expired');
  const view = await render(<App />);

  expect(view.getByText('Iniciar sesión')).toBeTruthy();
  expect(view.getByTestId('session-expired')).toBeTruthy();
  await act(async () => setSessionLifecycleState('active'));
});
