

// 🎯 Input de texto reutilizable
function crearInput({
  placeholder = '',
  value = '',
  onChange = null,
  type = 'text'
}) {
  const input = document.createElement('input');

  input.type = type;
  input.placeholder = placeholder;
  input.value = value;
  input.className = 'input-base';
  // 🔥 asegurar misma altura que select
  input.style.height = '40px';
  input.style.display = 'flex';
  input.style.alignItems = 'center';

  if (onChange) {
    input.addEventListener('input', (e) => {
      onChange(e.target.value);
    });
  }

  return input;
}

// export opcional
// export { crearInput };