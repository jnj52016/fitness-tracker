import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import App from './Auth';
import './styles.css';
import './app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#ed693d', borderRadius: 10, fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' } }}><AntApp><App /></AntApp></ConfigProvider>
  </React.StrictMode>,
);
