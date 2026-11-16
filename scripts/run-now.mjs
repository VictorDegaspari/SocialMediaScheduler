const base = process.env.APP_URL || 'http://localhost:4317';
const response = await fetch(`${base}/api/scan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Watcher-Request': '1' },
  body: '{}'
});
if (!response.ok) throw new Error('Não foi possível solicitar a verificação. Inicie o serviço e confira APP_URL.');
console.log('Verificação solicitada para todas as pastas ativas. A frequência de envio foi mantida.');
