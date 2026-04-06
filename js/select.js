// 🎯 Desplegable (select) reutilizable estilo input
function crearDesplegable({
  opciones = [],
  placeholder = 'Seleccionar',
  onChange = null,
  multiple = false
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'select-wrapper';

  let valoresSeleccionados = [];

  const selected = document.createElement('div');
  selected.className = 'select-selected';
  const text = document.createElement('span');
  text.className = 'select-text';
  text.innerText = placeholder;
  selected.appendChild(text);

  const list = document.createElement('div');
  list.className = 'select-items select-hide';

  // 🔥 opción seleccionar todos
  if (multiple) {
    const selectAll = document.createElement('div');
    selectAll.className = 'select-all-item';

    const checkboxAll = document.createElement('input');
    checkboxAll.type = 'checkbox';
    checkboxAll.className = 'select-checkbox';
    // 🔥 forzar tamaño pequeño
    checkboxAll.style.width = '11px';
    checkboxAll.style.height = '11px';
    checkboxAll.style.minWidth = '11px';

    checkboxAll.addEventListener('click', (e) => e.stopPropagation());

    const labelAll = document.createElement('span');
    labelAll.innerText = 'Seleccionar todos';

    selectAll.appendChild(checkboxAll);
    selectAll.appendChild(labelAll);

    selectAll.addEventListener('click', (e) => {
      e.stopPropagation();

      const allSelected = valoresSeleccionados.length === opciones.length;
      valoresSeleccionados = allSelected ? [] : [...opciones];

      Array.from(list.children).forEach(child => {
        if (child.dataset && child.dataset.value) {
          const isSelected = valoresSeleccionados.includes(child.dataset.value);
          child.classList.toggle('selected-item', isSelected);
          const cb = child.querySelector('input.select-checkbox');
          if (cb) cb.checked = isSelected;
        }
      });

      checkboxAll.checked = valoresSeleccionados.length === opciones.length;

      text.innerText = valoresSeleccionados.length > 0
        ? valoresSeleccionados.join(', ')
        : placeholder;

      if (onChange) onChange(valoresSeleccionados);
    });

    list.appendChild(selectAll);
  }

  opciones.forEach(op => {
    const item = document.createElement('div');
    item.dataset.value = op;

    if (multiple) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'select-checkbox';
      // 🔥 forzar tamaño pequeño
      checkbox.style.width = '11px';
      checkbox.style.height = '11px';
      checkbox.style.minWidth = '11px';

      checkbox.addEventListener('click', (e) => e.stopPropagation());

      const label = document.createElement('span');
      label.innerText = op;

      item.appendChild(checkbox);
      item.appendChild(label);
    } else {
      item.innerText = op;
    }

    item.addEventListener('click', (e) => {
      if (multiple) {
        e.stopPropagation();
        const index = valoresSeleccionados.indexOf(op);

        if (index === -1) {
          valoresSeleccionados.push(op);
          item.classList.add('selected-item');
        } else {
          valoresSeleccionados.splice(index, 1);
          item.classList.remove('selected-item');
        }

        const cb = item.querySelector('input.select-checkbox');
        if (cb) cb.checked = valoresSeleccionados.includes(op);

        text.innerText = valoresSeleccionados.length > 0
          ? valoresSeleccionados.join(', ')
          : placeholder;

        if (onChange) onChange(valoresSeleccionados);

      } else {
        text.innerText = op;
        list.classList.add('select-hide');
        selected.classList.remove('active');

        if (onChange) onChange(op);
      }
    });

    list.appendChild(item);
  });

  selected.addEventListener('click', (e) => {
    e.stopPropagation();

    // 🔥 cerrar otros dropdowns
    document.querySelectorAll('.select-items').forEach(el => {
      if (el !== list) el.classList.add('select-hide');
    });

    document.querySelectorAll('.select-selected').forEach(el => {
      if (el !== selected) el.classList.remove('active');
    });

    // 🔥 toggle actual
    list.classList.toggle('select-hide');
    selected.classList.toggle('active');
  });

  // cerrar si hace click afuera
  const closeDropdown = (e) => {
    if (!wrapper.contains(e.target)) {
      list.classList.add('select-hide');
      selected.classList.remove('active');
    }
  };
  document.addEventListener('click', closeDropdown);

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