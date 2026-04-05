

// 🎯 Desplegable (select) reutilizable estilo input
function crearDesplegable({
  opciones = [],
  placeholder = 'Seleccionar',
  onChange = null
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'select-wrapper';

  const selected = document.createElement('div');
  selected.className = 'select-selected';
  selected.innerText = placeholder;
  // 🔥 asegurar misma altura que input
  selected.style.height = '40px';
  selected.style.display = 'flex';
  selected.style.alignItems = 'center';

  const list = document.createElement('div');
  list.className = 'select-items select-hide';

  opciones.forEach(op => {
    const item = document.createElement('div');
    item.innerText = op;

    item.addEventListener('click', () => {
      selected.innerText = op;
      list.classList.add('select-hide');
      selected.classList.remove('active');

      if (onChange) onChange(op);
    });

    list.appendChild(item);
  });

  selected.addEventListener('click', () => {
    list.classList.toggle('select-hide');
    selected.classList.toggle('active');
  });

  // cerrar si hace click afuera
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      list.classList.add('select-hide');
      selected.classList.remove('active');
    }
  });

  wrapper.appendChild(selected);
  wrapper.appendChild(list);

  return wrapper;
}

// 🧩 estilos sugeridos (copiar a CSS global)
/*
.select-wrapper {
  position: relative;
  width: 100%;
}

.select-selected {
  padding: 10px 12px;
  border: 1px solid #DADAE5;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
}

.select-selected.active {
  border-color: #4B4EFC;
}

.select-items {
  position: absolute;
  top: 110%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #DADAE5;
  border-radius: 10px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.08);
  z-index: 99;
}

.select-items div {
  padding: 10px 12px;
  cursor: pointer;
}

.select-items div:hover {
  background: #F4F4F8;
}

.select-hide {
  display: none;
}
*/

// export opcional
// export { crearDesplegable };