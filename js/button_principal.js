// 🎯 Botón principal reutilizable
function crearBotonPrincipal({ texto = 'Crear', onClick = null, tipo = 'button', size = 'md' }) {
  const button = document.createElement('button');

  button.className = `btn-principal btn-${size}`;
  button.innerText = texto;
  button.type = tipo;

  if (onClick) {
    button.addEventListener('click', onClick);
  }

  return button;
}

// Exportar si lo querés usar en módulos (opcional)
// export { crearBotonPrincipal };