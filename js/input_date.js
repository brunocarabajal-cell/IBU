

// 🎯 Input de fecha reutilizable
function crearInputDate({
  value = '',
  onChange = null
}) {
  const input = document.createElement('input');

  input.type = 'date';
  input.value = value;
  input.className = 'input-base';

  // 🔥 asegurar mismo alto que el resto
  input.style.height = '40px';
  input.style.display = 'flex';
  input.style.alignItems = 'center';

  if (onChange) {
    input.addEventListener('change', (e) => {
      onChange(e.target.value);
    });
  }

  return input;
}

// export opcional
// export { crearInputDate };