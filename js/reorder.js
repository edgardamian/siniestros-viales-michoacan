/**
 * ==============================================================================
 * ARCHIVO: js/reorder.js
 * DESCRIPCIÓN: Módulo interactivo de Drag & Drop para reordenar gráficas.
 * Permite arrastrar y reacomodar los paneles de la columna derecha y central,
 * guardando las preferencias del usuario automáticamente en LocalStorage.
 * ==============================================================================
 */

const ReorderModule = {
    init() {
        this.initColumn('#sidebar', '.drag-item-filter', 'dash_sidebar_order');
        this.initColumn('#charts-col', '.drag-item', 'dash_right_order');
        this.initColumn('.map-col', '.drag-item-center', 'dash_center_order');
    },

    /**
     * Inicializa el soporte de arrastrar y soltar para una columna de tarjetas.
     */
    initColumn(containerSelector, itemSelector, storageKey) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        // 1. Restaurar orden personalizado previamente guardado
        const savedOrder = localStorage.getItem(storageKey);
        if (savedOrder) {
            try {
                const ids = JSON.parse(savedOrder);
                ids.forEach(id => {
                    const el = container.querySelector(`[data-drag-id="${id}"]`);
                    if (el) container.appendChild(el);
                });
            } catch (e) {
                console.warn("Error al restaurar orden de gráficas:", e);
            }
        }

        // 2. Configurar eventos de Drag & Drop
        const items = container.querySelectorAll(itemSelector);
        items.forEach(item => {
            item.setAttribute('draggable', 'true');

            item.addEventListener('dragstart', (e) => {
                // Prevenir inicio de arrastre si se interactúa con controles interactivos internos
                const tag = e.target.tagName;
                if (['INPUT', 'SELECT', 'BUTTON', 'A', 'CANVAS'].includes(tag)) {
                    e.preventDefault();
                    return;
                }

                item.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.getAttribute('data-drag-id') || '');
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('is-dragging');

                // Guardar la nueva secuencia de IDs en LocalStorage
                const currentIds = Array.from(container.querySelectorAll(itemSelector))
                    .map(el => el.getAttribute('data-drag-id'))
                    .filter(Boolean);
                localStorage.setItem(storageKey, JSON.stringify(currentIds));
            });
        });

        // 3. Gestionar la inserción en tiempo real mientras se arrastra
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const draggingEl = container.querySelector('.is-dragging');
            if (!draggingEl) return;

            const afterElement = this.getDragAfterElement(container, itemSelector, e.clientY);
            if (afterElement == null) {
                container.appendChild(draggingEl);
            } else {
                container.insertBefore(draggingEl, afterElement);
            }
        });
    },

    /**
     * Calcula qué elemento se encuentra inmediatamente después de la posición del cursor Y.
     */
    getDragAfterElement(container, itemSelector, y) {
        const draggableElements = [...container.querySelectorAll(`${itemSelector}:not(.is-dragging)`)];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    /**
     * Restablece el orden de todas las gráficas al orden inicial por defecto.
     */
    resetOrder() {
        localStorage.removeItem('dash_sidebar_order');
        localStorage.removeItem('dash_right_order');
        localStorage.removeItem('dash_center_order');
        window.location.reload();
    }
};

window.ReorderModule = ReorderModule;
