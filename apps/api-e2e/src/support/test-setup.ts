import axios from 'axios';
import { API_BASE_URL } from './env';

// Runs in every test file (Jest `setupFiles`): axios talks to the API started by the global setup.
// The statements run on load; a setupFiles module is not called as a function.
axios.defaults.baseURL = API_BASE_URL;
