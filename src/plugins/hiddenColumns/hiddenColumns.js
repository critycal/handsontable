import BasePlugin from '../_base';
import { addClass } from '../../helpers/dom/element';
import { rangeEach } from '../../helpers/number';
import { arrayEach } from '../../helpers/array';
import { registerPlugin } from '../../plugins';
import { SEPARATOR } from '../contextMenu/predefinedItems';
import Hooks from '../../pluginHooks';
import hideColumnItem from './contextMenuItem/hideColumn';
import showColumnItem from './contextMenuItem/showColumn';

import { ValueMap } from '../../translations';

import './hiddenColumns.css';

Hooks.getSingleton().register('beforeHideColumns');
Hooks.getSingleton().register('afterHideColumns');
Hooks.getSingleton().register('beforeUnhideColumns');
Hooks.getSingleton().register('afterUnhideColumns');

/**
 * @plugin HiddenColumns
 *
 * @description
 * Plugin allows to hide certain columns. The hiding is achieved by rendering the columns with width set as 0px.
 * The plugin not modifies the source data and do not participate in data transformation (the shape of data returned
 * by `getData*` methods stays intact).
 *
 * Possible plugin settings:
 *  * `copyPasteEnabled` as `Boolean` (default `true`)
 *  * `columns` as `Array`
 *  * `indicators` as `Boolean` (default `false`)
 *
 * @example
 *
 * ```js
 * const container = document.getElementById('example');
 * const hot = new Handsontable(container, {
 *   date: getData(),
 *   hiddenColumns: {
 *     copyPasteEnabled: true,
 *     indicators: true,
 *     columns: [1, 2, 5]
 *   }
 * });
 *
 * // access to hiddenColumns plugin instance:
 * const hiddenColumnsPlugin = hot.getPlugin('hiddenColumns');
 *
 * // show single row
 * hiddenColumnsPlugin.showColumn(1);
 *
 * // show multiple columns
 * hiddenColumnsPlugin.showColumn(1, 2, 9);
 *
 * // or as an array
 * hiddenColumnsPlugin.showColumns([1, 2, 9]);
 *
 * // hide single row
 * hiddenColumnsPlugin.hideColumn(1);
 *
 * // hide multiple columns
 * hiddenColumnsPlugin.hideColumn(1, 2, 9);
 *
 * // or as an array
 * hiddenColumnsPlugin.hideColumns([1, 2, 9]);
 *
 * // rerender the table to see all changes
 * hot.render();
 * ```
 */
class HiddenColumns extends BasePlugin {
  constructor(hotInstance) {
    super(hotInstance);
    /**
     * Cached plugin settings.
     *
     * @private
     * @type {Object}
     */
    this.settings = {};
    /**
     * List of currently hidden columns
     *
     * @private
     * @type {null|ValueMap}
     */
    this.hiddenColumnsMap = null;
    /**
     * Last selected column index.
     *
     * @private
     * @type {Number}
     * @default -1
     */
    this.lastSelectedColumn = -1;
  }

  /**
   * Checks if the plugin is enabled in the handsontable settings. This method is executed in {@link Hooks#beforeInit}
   * hook and if it returns `true` than the {@link HiddenColumns#enablePlugin} method is called.
   *
   * @returns {Boolean}
   */
  isEnabled() {
    return !!this.hot.getSettings().hiddenColumns;
  }

  /**
   * Enables the plugin functionality for this Handsontable instance.
   */
  enablePlugin() {
    if (this.enabled) {
      return;
    }

    this.hiddenColumnsMap = this.columnIndexMapper.registerMap('hiddenColumn', new ValueMap(false));
    this.hiddenColumnsMap.addLocalHook('init', () => this.onMapInit());

    this.addHook('afterContextMenuDefaultOptions', (...args) => this.onAfterContextMenuDefaultOptions(...args));
    this.addHook('afterGetCellMeta', (...args) => this.onAfterGetCellMeta(...args));
    this.addHook('afterGetColHeader', (...args) => this.onAfterGetColHeader(...args));
    this.addHook('beforeSetRangeEnd', (...args) => this.onBeforeSetRangeEnd(...args));
    this.addHook('beforeSetRangeStartOnly', (...args) => this.onBeforeSetRangeStart(...args));
    this.addHook('beforeStretchingColumnWidth', (...args) => this.onBeforeStretchingColumnWidth(...args));
    this.addHook('hiddenColumn', (...args) => this.isHidden(...args));
    this.addHook('modifyColWidth', (...args) => this.onModifyColWidth(...args));

    super.enablePlugin();
  }

  /**
   * Updates the plugin state. This method is executed when {@link Core#updateSettings} is invoked.
   */
  updatePlugin() {
    this.disablePlugin();
    this.hiddenColumnsMap.clear();
    this.enablePlugin();
    // For some reason hiddenColumnsMap doesn't call it during updatePlugin.
    this.onMapInit();

    super.updatePlugin();
  }

  /**
   * Disables the plugin functionality for this Handsontable instance.
   */
  disablePlugin() {
    this.columnIndexMapper.unregisterMap('hiddenColumn');
    this.settings = {};
    this.lastSelectedColumn = -1;

    // this.hot.render();
    super.disablePlugin();
    this.resetCellsMeta();
  }

  /**
   * Shows the provided columns.
   *
   * @param {Number[]} columns Array of visual column indexes.
   */
  showColumns(columns) {
    const currentHideConfig = this.getHiddenColumns();
    const validColumns = this.isColumnDataValid(columns);
    let destinationHideConfig = currentHideConfig;

    if (validColumns) {
      destinationHideConfig = currentHideConfig.filter(hiddenColumn => columns.includes(hiddenColumn) === false);

      columns.forEach((visualColumn) => {
        this.hiddenColumnsMap.setValueAtIndex(this.hot.toPhysicalColumn(visualColumn), false);
      });
    }

    const continueHiding = this.hot.runHooks('beforeUnhideColumns', currentHideConfig, destinationHideConfig, validColumns);

    if (continueHiding === false) {
      return;
    }

    if (validColumns) {
      this.hiddenColumns = destinationHideConfig;
    }

    this.hot.runHooks('afterUnhideColumns', currentHideConfig, destinationHideConfig, validColumns,
      validColumns && destinationHideConfig.length < currentHideConfig.length);
  }

  /**
   * Shows a single column.
   *
   * @param {...Number} column Visual column index.
   */
  showColumn(...column) {
    this.showColumns(column);
  }

  /**
   * Hides the columns provided in the array.
   *
   * @param {Number[]} columns Array of visual column indexes.
   */
  hideColumns(columns) {
    const currentHideConfig = this.getHiddenColumns();
    const validColumns = this.isColumnDataValid(columns);
    let destinationHideConfig = currentHideConfig;

    if (validColumns) {
      destinationHideConfig = Array.from(new Set(currentHideConfig.concat(columns)));
    }

    const continueHiding = this.hot.runHooks('beforeHideColumns', currentHideConfig, destinationHideConfig, validColumns);

    if (continueHiding === false) {
      return;
    }

    if (validColumns) {
      columns.forEach((visualColumn) => {
        this.hiddenColumnsMap.setValueAtIndex(this.hot.toPhysicalColumn(visualColumn), true);
      });
    }

    this.hot.runHooks('afterHideColumns', currentHideConfig, destinationHideConfig, validColumns,
      validColumns && destinationHideConfig.length > currentHideConfig.length);
  }

  /**
   * Hides a single column.
   *
   * @param {...Number} column Visual column index.
   */
  hideColumn(...column) {
    this.hideColumns(column);
  }

  /**
   * Returns an array of physical indexes of hidden columns.
   *
   * @returns {Number[]}
   */
  getHiddenColumns() {
    return this.hiddenColumnsMap.getValues().reduce((hiddenColumns, flag, index) => {
      if (flag) {
        hiddenColumns.push(index);
      }

      return hiddenColumns;
    }, []);
  }

  /**
   * Checks if the provided column is hidden.
   *
   * @param {Number} column Column index.
   * @param {Boolean} isPhysicalIndex flag which determines type of index.
   * @returns {Boolean}
   */
  isHidden(column, isPhysicalIndex = false) {
    let physicalColumn = column;

    if (!isPhysicalIndex) {
      physicalColumn = this.hot.toPhysicalColumn(column);
    }

    // return this.hiddenColumns.includes(physicalColumn);
    return this.hiddenColumnsMap.getValueAtIndex(physicalColumn);
  }

  /**
   * Check whether all of the provided column indexes are within the bounds of the table.
   *
   * @param {Array} columns Array of column indexes.
   */
  isColumnDataValid(columns) {
    return columns.every(column => Number.isInteger(column) && column >= 0 && column < this.hot.countCols());
  }

  /**
   * Reset all rendered cells meta.
   *
   * @private
   */
  resetCellsMeta() {
    arrayEach(this.hot.getCellsMeta(), (meta) => {
      if (meta) {
        meta.skipColumnOnPaste = false;

        if (meta.baseRenderer !== null) {
          meta.renderer = meta.baseRenderer;
          meta.baseRenderer = null;
        }
      }
    });
  }

  /**
   * Sets width hidden columns on 0
   *
   * @private
   * @param {Number} width Column width.
   * @param {Number} column Column index.
   * @returns {Number}
   */
  onBeforeStretchingColumnWidth(width, column) {
    let stretchedWidth = width;

    if (this.isHidden(column)) {
      stretchedWidth = 0;
    }

    return stretchedWidth;
  }

  /**
   * Adds the additional column width for the hidden column indicators.
   *
   * @private
   * @param {Number} width
   * @param {Number} col
   * @returns {Number}
   */
  onModifyColWidth(width, col) {
    if (this.isHidden(col)) {
      return 0.1;

    } else if (this.settings.indicators && (this.isHidden(col + 1) ||
               this.isHidden(col - 1))) {

      // add additional space for hidden column indicator
      return width + (this.hot.hasColHeaders() ? 15 : 0);
    }
  }

  /**
   * Sets the copy-related cell meta.
   *
   * @private
   * @param {Number} row
   * @param {Number} col
   * @param {Object} cellProperties
   *
   * @fires Hooks#unmodifyCol
   */
  onAfterGetCellMeta(row, col, cellProperties) {
    const colIndex = this.hot.toVisualColumn(col);

    if (this.settings.copyPasteEnabled === false && this.isHidden(col)) {
      cellProperties.skipColumnOnPaste = true;
    }

    if (this.isHidden(colIndex)) {
      if (cellProperties.renderer !== hiddenRenderer) {
        cellProperties.baseRenderer = cellProperties.renderer;
      }
      cellProperties.renderer = hiddenRenderer;

    } else if (cellProperties.baseRenderer !== null) { // We must pass undefined value too (for the purposes of inheritance cell/column settings).
      cellProperties.renderer = cellProperties.baseRenderer;
      cellProperties.baseRenderer = null;
    }

    if (this.isHidden(cellProperties.visualCol - 1)) {
      let firstSectionHidden = true;
      let i = cellProperties.visualCol - 1;

      cellProperties.className = cellProperties.className || '';

      if (cellProperties.className.indexOf('afterHiddenColumn') === -1) {
        cellProperties.className += ' afterHiddenColumn';
      }

      do {
        if (!this.isHidden(i)) {
          firstSectionHidden = false;
          break;
        }

        i -= 1;
      } while (i >= 0);

      if (firstSectionHidden && cellProperties.className.indexOf('firstVisibleColumn') === -1) {
        cellProperties.className += ' firstVisibleColumn';
      }
    } else if (cellProperties.className) {
      const classArr = cellProperties.className.split(' ');

      if (classArr.length) {
        const containAfterHiddenColumn = classArr.indexOf('afterHiddenColumn');

        if (containAfterHiddenColumn > -1) {
          classArr.splice(containAfterHiddenColumn, 1);
        }

        const containFirstVisible = classArr.indexOf('firstVisibleColumn');

        if (containFirstVisible > -1) {
          classArr.splice(containFirstVisible, 1);
        }

        cellProperties.className = classArr.join(' ');
      }
    }
  }

  /**
   * Modifies the copyable range, accordingly to the provided config.
   *
   * @private
   * @param {Array} ranges
   * @returns {Array}
   */
  onModifyCopyableRange(ranges) {
    const newRanges = [];

    const pushRange = (startRow, endRow, startCol, endCol) => {
      newRanges.push({ startRow, endRow, startCol, endCol });
    };

    arrayEach(ranges, (range) => {
      let isHidden = true;
      let rangeStart = 0;

      rangeEach(range.startCol, range.endCol, (col) => {
        if (this.isHidden(col)) {
          if (!isHidden) {
            pushRange(range.startRow, range.endRow, rangeStart, col - 1);
          }

          isHidden = true;

        } else {
          if (isHidden) {
            rangeStart = col;
          }

          if (col === range.endCol) {
            pushRange(range.startRow, range.endRow, rangeStart, col);
          }

          isHidden = false;
        }
      });
    });

    return newRanges;
  }

  /**
   * Adds the needed classes to the headers.
   *
   * @private
   * @param {Number} column
   * @param {HTMLElement} TH
   */
  onAfterGetColHeader(column, TH) {
    if (this.isHidden(column)) {
      return;
    }

    let firstSectionHidden = true;
    let i = column - 1;

    do {
      if (!this.isHidden(i)) {
        firstSectionHidden = false;
        break;
      }
      i -= 1;
    } while (i >= 0);

    if (firstSectionHidden) {
      addClass(TH, 'firstVisibleColumn');
    }

    if (!this.settings.indicators) {
      return;
    }

    if (this.isHidden(column - 1)) {
      addClass(TH, 'afterHiddenColumn');
    }

    if (this.isHidden(column + 1) && column > -1) {
      addClass(TH, 'beforeHiddenColumn');
    }
  }

  /**
   * On before set range start listener.
   *
   * @private
   * @param {Object} coords Object with `row` and `col` properties.
   */
  onBeforeSetRangeStart(coords) {
    if (coords.col > 0) {
      return;
    }

    coords.col = 0;

    const getNextColumn = (col) => {
      let visualColumn = col;
      const physicalColumn = this.hot.toPhysicalColumn(visualColumn);

      if (this.isHidden(physicalColumn, true)) {
        visualColumn += 1;
        visualColumn = getNextColumn(visualColumn);
      }

      return visualColumn;
    };

    coords.col = getNextColumn(coords.col);
  }

  /**
   * On before set range end listener.
   *
   * @private
   * @param {Object} coords Object with `row` and `col` properties.
   */
  onBeforeSetRangeEnd(coords) {
    const columnCount = this.hot.countCols();

    const getNextColumn = (col) => {
      let visualColumn = col;
      const physicalColumn = this.hot.toPhysicalColumn(visualColumn);

      if (this.isHidden(physicalColumn, true)) {
        if (this.lastSelectedColumn > visualColumn || coords.col === columnCount - 1) {
          if (visualColumn > 0) {
            visualColumn -= 1;
            visualColumn = getNextColumn(visualColumn);

          } else {
            rangeEach(0, this.lastSelectedColumn, (i) => {
              if (!this.isHidden(i)) {
                visualColumn = i;

                return false;
              }
            });
          }
        } else {
          visualColumn += 1;
          visualColumn = getNextColumn(visualColumn);
        }
      }

      return visualColumn;
    };

    coords.col = getNextColumn(coords.col);
    this.lastSelectedColumn = coords.col;
  }

  /**
   * Add Show-hide columns to context menu.
   *
   * @private
   * @param {Object} options
   */
  onAfterContextMenuDefaultOptions(options) {
    options.items.push(
      {
        name: SEPARATOR
      },
      hideColumnItem(this),
      showColumnItem(this)
    );
  }

  /**
   * `afterPluginsInitialized` hook callback.
   *
   * @private
   */
  onMapInit() {
    const settings = this.hot.getSettings().hiddenColumns;

    if (typeof settings === 'object') {
      this.settings = settings;

      if (settings.copyPasteEnabled === void 0) {
        settings.copyPasteEnabled = true;
      }

      if (Array.isArray(settings.columns)) {
        // this.hiddenColumnsMap.clear();
        this.hideColumns(settings.columns);
      }

      if (!settings.copyPasteEnabled) {
        this.addHook('modifyCopyableRange', ranges => this.onModifyCopyableRange(ranges));
      }
    }
  }

  /**
   * Destroys the plugin instance.
   */
  destroy() {
    super.destroy();
  }
}

function hiddenRenderer(hotInstance, td) {
  td.textContent = '';
}

registerPlugin('hiddenColumns', HiddenColumns);

export default HiddenColumns;
