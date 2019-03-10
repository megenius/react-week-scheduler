import 'resize-observer-polyfill/dist/ResizeObserver.global';

import React, {
  useRef,
  useState,
  useMemo,
  useCallback,
  useEffect
} from 'react';
import ReactDOM from 'react-dom';
import invariant from 'invariant';
import { times } from 'lodash';
import { format, startOfWeek, addDays, compareAsc } from 'date-fns';
import useComponentSize from '@rehooks/component-size';
import useUndo from 'use-undo';
import scrollIntoView from 'scroll-into-view-if-needed';
import useMousetrap from './useMousetrap';
import cc from 'classcat';
// @ts-ignore
import Resizable, { ResizeCallback } from 're-resizable';
import Draggable, { DraggableEventHandler } from 'react-draggable';

import { useClickAndDrag } from './useClickAndDrag';

import {
  RecurringTimeRange,
  createMapCellInfoToRecurringTimeRange
} from './createMapCellInfoToRecurringTimeRange';
import { createMapDateRangeToCells } from './createMapDateRangeToCells';
import { createGridForContainer } from './utils/createGridFromContainer';
import { getTextForDateRange } from './utils/getTextForDateRange';
import { Grid, Event as CalendarEvent, CellInfo, DateRange } from './types';
import { createMapCellInfoToContiguousDateRange } from './createMapCellInfoToContiguousDateRange';
import { mergeEvents, mergeRanges } from './utils/mergeEvents';

import classes from './styles.module.scss';
import { useScrollPosition } from './utils/useScrollPosition';

const originDate = startOfWeek(new Date(), { weekStartsOn: 1 });

const MINS_IN_DAY = 24 * 60;
const verticalPrecision = 1 / 15;
const horizontalPrecision = 1;
const numVerticalCells = MINS_IN_DAY * verticalPrecision;
const numHorizontalCells = 7 * horizontalPrecision;
const toMin = (y: number) => y / verticalPrecision;
const toDay = (x: number) => x / horizontalPrecision;
const toX = (days: number) => days * horizontalPrecision;
const toY = (mins: number) => mins * verticalPrecision;

const cellInfoToDateRanges = createMapCellInfoToRecurringTimeRange({
  originDate,
  fromY: toMin,
  fromX: toDay
});

const cellInfoToSingleDateRange = (cell: CellInfo): DateRange => {
  const [first, ...rest] = cellInfoToDateRanges(cell);

  invariant(
    rest.length === 0,
    `Expected "cellInfoToSingleDateRange" to return a single date range, found ${
      rest.length
    } additional ranges instead. This is a bug in @remotelock/weekly-scheduler`
  );

  return first;
};

const dateRangeToCells = createMapDateRangeToCells({
  originDate,
  numVerticalCells,
  numHorizontalCells,
  toX,
  toY
});

type OnChangeCallback = (
  newDateRange: DateRange | undefined,
  rangeIndex: number
) => void;

function RangeBox({
  grid,
  isBeingEdited,
  rangeIndex,
  cellIndex,
  cellArray,
  cell,
  className,
  onMove,
  cellInfoToDateRange,
  isResizable,
  isDeletable,
  isMovable
}: {
  grid: Grid;
  cell: CellInfo;
  cellIndex: number;
  cellArray: CellInfo[];
  className?: string;
  onMove?: OnChangeCallback;
  isResizable?: boolean;
  isDeletable?: boolean;
  isMovable?: boolean;
  rangeIndex: number;
  isBeingEdited?(cell: CellInfo): boolean;
  cellInfoToDateRange(cell: CellInfo): DateRange;
}) {
  const [modifiedCell, setModifiedCell] = useState(cell);
  const originalRect = useMemo(() => grid.getRectFromCell(cell), [cell, grid]);
  const rect = useMemo(() => grid.getRectFromCell(modifiedCell), [
    modifiedCell,
    grid
  ]);

  const ref = useRef(null);

  useEffect(() => {
    setModifiedCell(cell);
  }, [cell]);

  const modifiedDateRange = useMemo(() => cellInfoToDateRange(modifiedCell), [
    modifiedCell
  ]);

  const handleDelete = useCallback(() => {
    if (!isDeletable) {
      return;
    }

    onMove && onMove(undefined, rangeIndex);
  }, [ref.current, onMove, isDeletable, rangeIndex]);

  useMousetrap('del', handleDelete, ref.current);

  const { top, left, width, height } = rect;

  const style = { width, height };

  const isStart = cellIndex === 0;
  const isEnd = cellIndex === cellArray.length - 1;

  const handleStop = useCallback(() => {
    onMove && onMove(cellInfoToDateRange(modifiedCell), rangeIndex);
  }, [modifiedCell, rangeIndex, onMove]);

  useMousetrap(
    'up',
    () => {
      if (!isMovable) {
        return;
      }

      if (modifiedCell.startY === 0) {
        return;
      }

      const newCell = {
        ...modifiedCell,
        startY: modifiedCell.startY - 1,
        endY: modifiedCell.endY - 1
      };

      onMove && onMove(cellInfoToDateRange(newCell), rangeIndex);
    },
    ref.current
  );

  useMousetrap(
    'down',
    () => {
      if (!isMovable) {
        return;
      }

      if (modifiedCell.endY === grid.numVerticalCells - 1) {
        return;
      }

      const newCell = {
        ...modifiedCell,
        startY: modifiedCell.startY + 1,
        endY: modifiedCell.endY + 1
      };

      onMove && onMove(cellInfoToDateRange(newCell), rangeIndex);
    },
    ref.current
  );

  const handleDrag: DraggableEventHandler = useCallback(
    (_event, { y }) => {
      if (!isMovable) {
        return;
      }

      const _start = y;
      const _end = _start + rect.height;
      const newTop = Math.min(_start, _end);
      const newBottom = newTop + rect.height;

      if (newTop === top) {
        return;
      }

      const newRect = {
        ...rect,
        top: newTop,
        bottom: newBottom
      };

      const { startY, endY } = grid.getCellFromRect(newRect);

      const newCell = {
        ...cell,
        startY,
        endY
      };

      invariant(
        newCell.spanY === cell.spanY,
        `Expected the dragged time cell to have the same height (${
          newCell.spanY
        }, ${cell.spanY})`
      );
      setModifiedCell(newCell);
    },
    [grid, rect]
  );

  const handleResize: ResizeCallback = useCallback(
    (_event, direction, _ref, delta) => {
      if (!isResizable) {
        return;
      }

      if (delta.height === 0) {
        return;
      }

      const newSize = {
        height: delta.height + rect.height,
        width: delta.width + rect.width
      };

      const newRect = {
        ...originalRect,
        ...newSize
      };

      if (direction.includes('top')) {
        newRect.top -= delta.height;
      } else if (direction.includes('bottom')) {
        newRect.bottom += delta.height;
      }

      const { spanY, startY, endY } = grid.getCellFromRect(newRect);
      const newCell = {
        ...cell,
        spanY,
        startY,
        endY
      };

      setModifiedCell(newCell);
    },
    [grid, rect, originalRect]
  );

  return (
    <Draggable
      axis={isMovable ? 'y' : 'none'}
      bounds={{
        top: 0,
        bottom: grid.totalHeight - height,
        left: 0,
        right: grid.totalWidth
      }}
      position={{ x: left, y: top }}
      onDrag={handleDrag}
      onStop={handleStop}
      cancel={classes['handle']}
    >
      <button
        className={cc([
          classes['event'],
          classes['button-reset'],
          classes['range-box'],
          className,
          {
            [classes['is-draggable']]: isMovable,
            [classes['is-being-edited']]: isBeingEdited && isBeingEdited(cell)
          }
        ])}
        ref={ref}
        tabIndex={0}
        style={style}
      >
        <Resizable
          size={originalRect}
          onResize={handleResize}
          onResizeStop={handleStop}
          handleWrapperClass={classes['handle-wrapper']}
          enable={
            isResizable
              ? {
                  top: true,
                  bottom: true
                }
              : {}
          }
          handleClasses={{
            bottom: cc([classes['handle'], classes.bottom]),
            bottomLeft: cc([classes['handle'], classes['bottom-left']]),
            bottomRight: cc([classes['handle'], classes['bottom-right']]),
            left: cc([classes['handle'], classes.left]),
            right: cc([classes['handle'], classes.right]),
            top: cc([classes['handle'], classes.top]),
            topLeft: cc([classes['handle'], classes['top-left']]),
            topRight: cc([classes['handle'], classes['top-right']])
          }}
        >
          <div className={classes['event-content']} style={style}>
            <span className={classes['start']}>
              {isStart && format(modifiedDateRange[0], 'h:mma')}
            </span>
            <span className={classes['end']}>
              {isEnd && format(modifiedDateRange[1], 'h:mma')}
            </span>
          </div>
        </Resizable>
      </button>
    </Draggable>
  );
}

function Schedule({
  ranges,
  grid,
  className,
  onChange,
  isResizable,
  isDeletable,
  isMovable,
  cellInfoToDateRange,
  isBeingEdited
}: {
  ranges: CalendarEvent;
  grid: Grid;
  className?: string;
  isResizable?: boolean;
  isDeletable?: boolean;
  isMovable?: boolean;
  onChange?: OnChangeCallback;
  isBeingEdited?(cell: CellInfo): boolean;
  cellInfoToDateRange(cell: CellInfo): DateRange;
}) {
  return (
    <div className={classes['range-boxes']}>
      {ranges.map((dateRange, rangeIndex) => {
        return (
          <span key={rangeIndex}>
            {dateRangeToCells(dateRange).map((cell, cellIndex, array) => {
              return (
                <RangeBox
                  key={cellIndex}
                  isResizable={isResizable}
                  isMovable={isMovable}
                  isDeletable={isDeletable}
                  cellInfoToDateRange={cellInfoToDateRange}
                  cellArray={array}
                  cellIndex={cellIndex}
                  rangeIndex={rangeIndex}
                  className={className}
                  isBeingEdited={isBeingEdited}
                  onMove={onChange}
                  grid={grid}
                  cell={cell}
                />
              );
            })}
          </span>
        );
      })}
    </div>
  );
}

const defaultSchedule: [string, string][] = [
  // ['2019-03-03T22:45:00.000Z', '2019-03-04T01:15:00.000Z'],
  ['2019-03-05T22:00:00.000Z', '2019-03-06T01:00:00.000Z'],
  ['2019-03-04T22:15:00.000Z', '2019-03-05T01:00:00.000Z'],
  ['2019-03-07T05:30:00.000Z', '2019-03-07T10:00:00.000Z'],
  // ['2019-03-08T22:00:00.000Z', '2019-03-09T01:00:00.000Z'],
  ['2019-03-09T22:00:00.000Z', '2019-03-10T01:00:00.000Z'],
  ['2019-03-06T22:00:00.000Z', '2019-03-07T01:00:00.000Z']
];

function App() {
  const root = useRef<HTMLDivElement | null>(null);
  const parent = useRef<HTMLDivElement | null>(null);
  const { scrollLeft, scrollTop } = useScrollPosition(root, false);

  const stickyStyle = useMemo<React.CSSProperties>(
    () => ({ transform: `translate(${scrollLeft}, ${scrollTop}px)` }),
    [scrollLeft, scrollTop]
  );

  const size = useComponentSize(parent);
  const {
    style,
    box,
    isDragging,
    hasFinishedDragging,
    cancel
  } = useClickAndDrag(parent);
  const [
    pendingCreation,
    setPendingCreation
  ] = useState<RecurringTimeRange | null>(null);
  const [
    scheduleState,
    {
      set: setSchedule,
      undo: undoSchedule,
      redo: redoSchedule,
      canUndo: canUndoSchedule,
      canRedo: canRedoSchedule
    }
  ] = useUndo<CalendarEvent>(
    defaultSchedule
      .map(
        range => range.map(dateString => new Date(dateString)) as [Date, Date]
      )
      .sort((range1, range2) => compareAsc(range1[0], range2[0]))
  );

  const { totalHeight, totalWidth } = useMemo(() => {
    let totalHeight: number | null = null;
    let totalWidth: number | null = null;
    if (parent.current !== null) {
      ({ scrollHeight: totalHeight, scrollWidth: totalWidth } = parent.current);
    }

    return { totalHeight, totalWidth };
  }, [size]);

  const grid = useMemo<Grid | null>(() => {
    if (totalHeight === null || totalWidth === null) {
      return null;
    }

    return createGridForContainer({
      totalHeight,
      totalWidth,
      numHorizontalCells,
      numVerticalCells
    });
  }, [totalHeight, totalWidth, numHorizontalCells, numVerticalCells]);

  useEffect(() => {
    if (grid === null || box === null) {
      setPendingCreation(null);
      return;
    }

    const constrainedBox = box;
    const cell = grid.getCellFromRect(constrainedBox);
    const dateRanges = cellInfoToDateRanges(cell);
    const event = dateRanges;
    console.log(...event.map(d => getTextForDateRange(d)));
    setPendingCreation(event);
  }, [box, grid, setPendingCreation]);

  useEffect(() => {
    if (hasFinishedDragging) {
      setSchedule(mergeEvents(scheduleState.present, pendingCreation));
      setPendingCreation(null);
    }
  }, [
    hasFinishedDragging,
    setSchedule,
    setPendingCreation,
    pendingCreation,
    scheduleState.present
  ]);

  useMousetrap(
    'ctrl+z',
    () => {
      if (!canUndoSchedule) {
        return;
      }

      undoSchedule();
    },
    document
  );

  useMousetrap(
    'ctrl+shift+z',
    () => {
      if (!canRedoSchedule) {
        return;
      }

      redoSchedule();
    },
    document
  );

  useMousetrap(
    'esc',
    () => {
      if (pendingCreation) {
        cancel();
      }
    },
    document
  );

  const handleEventChange = useCallback<OnChangeCallback>(
    (newDateRange, rangeIndex) => {
      if (!scheduleState.present && newDateRange) {
        return [newDateRange];
      }

      const newSchedule = [...scheduleState.present];

      if (!newDateRange) {
        console.log(rangeIndex, 'will be deleted from', newSchedule);
        newSchedule.splice(rangeIndex, 1);
      } else {
        newSchedule[rangeIndex] = newDateRange;
      }

      setSchedule(mergeRanges(newSchedule));
    },
    [scheduleState.present]
  );

  const getDateRangeForVisualGrid = useMemo(
    () =>
      createMapCellInfoToContiguousDateRange({
        originDate,
        fromX: toDay,
        fromY: y => y * 30
      }),
    [toDay, originDate]
  );

  useEffect(() => {
    // @ts-ignore
    document.activeElement &&
      scrollIntoView(document.activeElement, {
        scrollMode: 'if-needed',
        block: 'nearest',
        inline: 'nearest'
      });
  }, [document.activeElement, scheduleState.present]);

  return (
    <div ref={root} className={classes['root']}>
      <div className={classes['timeline']}>
        <div style={stickyStyle} className={classes['header']}>
          <div className={classes['day-column']}>
            <div className={cc([classes['cell'], classes.title])}>Timeline</div>
          </div>
        </div>
        <div className={classes['calendar']}>
          <div className={classes['day-column']}>
            <div className={classes['day-hours']}>
              {times(48).map(timeIndex => {
                let startText = '';
                if (timeIndex % 2 === 0) {
                  const [[start]] = getDateRangeForVisualGrid({
                    startX: 0,
                    startY: timeIndex,
                    endX: 0,
                    endY: timeIndex + 1,
                    spanX: 1,
                    spanY: 1
                  });
                  startText = format(start, 'h a');
                }

                return (
                  <div key={timeIndex} className={classes['cell']}>
                    <div className={classes['time']}>{startText}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div
          style={stickyStyle}
          className={cc([classes['calendar'], classes.header])}
        >
          {times(7).map(i => (
            <div key={i} className={classes['day-column']}>
              <div className={cc([classes['cell'], classes.title])}>
                {format(addDays(originDate, i), 'ddd')}
              </div>
            </div>
          ))}
        </div>
        <div className={classes['layer-container']}>
          {isDragging && (
            <div className={classes['drag-box']} style={style}>
              {hasFinishedDragging && <div className={classes['popup']} />}
            </div>
          )}
          {grid && pendingCreation && isDragging && (
            <Schedule
              cellInfoToDateRange={cellInfoToSingleDateRange}
              className={classes['is-pending-creation']}
              ranges={mergeEvents(scheduleState.present, pendingCreation)}
              grid={grid}
            />
          )}
          {grid && !pendingCreation && (
            <Schedule
              cellInfoToDateRange={cellInfoToSingleDateRange}
              isResizable
              isMovable
              isDeletable
              onChange={handleEventChange}
              ranges={scheduleState.present}
              grid={grid}
            />
          )}

          <div ref={parent} className={classes['calendar']}>
            {times(7).map(dayIndex => {
              return (
                <div key={dayIndex} className={classes['day-column']}>
                  <div className={classes['day-hours']}>
                    {times(48).map(timeIndex => {
                      return (
                        <div key={timeIndex} className={classes['cell']}>
                          <div className={classes['debug']}>
                            ({dayIndex}, {timeIndex})
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
ReactDOM.render(<App />, rootElement);
