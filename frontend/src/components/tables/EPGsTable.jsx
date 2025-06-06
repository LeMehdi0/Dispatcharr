import { useEffect, useMemo, useRef, useState } from 'react';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table';
import API from '../../api';
import useEPGsStore from '../../store/epgs';
import EPGForm from '../forms/EPG';
import { TableHelper } from '../../helpers';
import {
  ActionIcon,
  Text,
  Tooltip,
  Box,
  Paper,
  Button,
  Flex,
  useMantineTheme,
  Switch,
  Badge,
  Progress,
  Stack,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSquarePlus } from '@tabler/icons-react';
import { RefreshCcw, SquareMinus, SquarePen } from 'lucide-react';
import dayjs from 'dayjs';
import useSettingsStore from '../../store/settings';
import useLocalStorage from '../../hooks/useLocalStorage';
import ConfirmationDialog from '../../components/ConfirmationDialog';
import useWarningsStore from '../../store/warnings';

// Helper function to format status text
const formatStatusText = (status) => {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
};

// Helper function to get status text color
const getStatusColor = (status) => {
  switch (status) {
    case 'idle': return 'gray.5';
    case 'fetching': return 'blue.5';
    case 'parsing': return 'indigo.5';
    case 'error': return 'red.5';
    case 'success': return 'green.5';
    default: return 'gray.5';
  }
};

const EPGsTable = () => {
  const [epg, setEPG] = useState(null);
  const [epgModalOpen, setEPGModalOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [epgToDelete, setEpgToDelete] = useState(null);

  const epgs = useEPGsStore((s) => s.epgs);
  const refreshProgress = useEPGsStore((s) => s.refreshProgress);

  const theme = useMantineTheme();
  // Get tableSize directly from localStorage instead of the store
  const [tableSize] = useLocalStorage('table-size', 'default');

  // Get proper size for action icons to match ChannelsTable
  const iconSize = tableSize === 'compact' ? 'xs' : tableSize === 'large' ? 'md' : 'sm';

  // Calculate density for Mantine Table
  const tableDensity = tableSize === 'compact' ? 'xs' : tableSize === 'large' ? 'xl' : 'md';

  const isWarningSuppressed = useWarningsStore((s) => s.isWarningSuppressed);
  const suppressWarning = useWarningsStore((s) => s.suppressWarning);

  const toggleActive = async (epg) => {
    try {
      // Send only the is_active field to trigger our special handling
      await API.updateEPG({
        id: epg.id,
        is_active: !epg.is_active,
      }, true); // Add a new parameter to indicate this is just a toggle
    } catch (error) {
      console.error('Error toggling active state:', error);
    }
  };

  const buildProgressDisplay = (data) => {
    const progress = refreshProgress[data.id] || null;

    if (!progress) return null;

    let label = '';
    switch (progress.action) {
      case 'downloading':
        label = 'Downloading';
        break;
      case 'parsing_channels':
        label = 'Parsing Channels';
        break;
      case 'parsing_programs':
        label = 'Parsing Programs';
        break;
      default:
        return null;
    }

    return (
      <Stack spacing={2}>
        <Text size="xs">{label}: {parseInt(progress.progress)}%</Text>
        <Progress value={parseInt(progress.progress)} size="xs" style={{ margin: '2px 0' }} />
        {progress.speed && <Text size="xs">Speed: {parseInt(progress.speed)} KB/s</Text>}
      </Stack>
    );
  };

  const columns = useMemo(
    //column definitions...
    () => [
      {
        header: 'Name',
        accessorKey: 'name',
        size: 150,
        minSize: 100,
      },
      {
        header: 'Source Type',
        accessorKey: 'source_type',
        size: 120,
        minSize: 100,
      },
      {
        header: 'URL / API Key / File Path',
        accessorKey: 'url',
        size: 200,
        minSize: 120,
        enableSorting: false,
        Cell: ({ cell, row }) => {
          const value = cell.getValue() || row.original.api_key || row.original.file_path || '';
          return (
            <Tooltip label={value} disabled={!value}>
              <div
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                {value}
              </div>
            </Tooltip>
          );
        },
      },
      {
        header: 'Status',
        accessorKey: 'status',
        size: 100,
        minSize: 80,
        Cell: ({ row }) => {
          const data = row.original;

          // Always show status text, even when there's progress happening
          return (
            <Text
              size="sm"
              fw={500}
              c={getStatusColor(data.status)}
            >
              {formatStatusText(data.status)}
            </Text>
          );
        },
      },
      {
        header: 'Status Message',
        accessorKey: 'last_message',
        size: 250,
        minSize: 150,
        enableSorting: false,
        Cell: ({ row }) => {
          const data = row.original;

          // Check if there's an active progress for this EPG - show progress first if active
          if (refreshProgress[data.id] && refreshProgress[data.id].progress < 100) {
            return buildProgressDisplay(data);
          }

          // Show error message when status is error
          if (data.status === 'error' && data.last_message) {
            return (
              <Tooltip label={data.last_message} multiline width={300}>
                <Text c="dimmed" size="xs" lineClamp={2} style={{ color: theme.colors.red[6], lineHeight: 1.3 }}>
                  {data.last_message}
                </Text>
              </Tooltip>
            );
          }

          // Show success message for successful sources
          if (data.status === 'success') {
            return (
              <Text c="dimmed" size="xs" style={{ color: theme.colors.green[6], lineHeight: 1.3 }}>
                EPG data refreshed successfully
              </Text>
            );
          }

          // Otherwise return empty cell
          return null;
        },
      },
      {
        header: 'Updated',
        accessorKey: 'updated_at',
        size: 180,
        minSize: 100,
        enableSorting: false,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return value ? dayjs(value).format('MMMM D, YYYY h:mma') : 'Never';
        },
      },
      {
        header: 'Active',
        accessorKey: 'is_active',
        size: 80,
        minSize: 60,
        sortingFn: 'basic',
        mantineTableBodyCellProps: {
          align: 'left',
        },
        Cell: ({ row, cell }) => (
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Switch
              size="xs"
              checked={cell.getValue()}
              onChange={() => toggleActive(row.original)}
            />
          </Box>
        ),
      },
    ],
    [refreshProgress]
  );

  //optionally access the underlying virtualizer instance
  const rowVirtualizerInstanceRef = useRef(null);

  const [isLoading, setIsLoading] = useState(true);
  const [sorting, setSorting] = useState([]);

  const editEPG = async (epg = null) => {
    setEPG(epg);
    setEPGModalOpen(true);
  };

  const deleteEPG = async (id) => {
    // Get EPG details for the confirmation dialog
    const epgObj = epgs[id];
    setEpgToDelete(epgObj);
    setDeleteTarget(id);

    // Skip warning if it's been suppressed
    if (isWarningSuppressed('delete-epg')) {
      return executeDeleteEPG(id);
    }

    setConfirmDeleteOpen(true);
  };

  const executeDeleteEPG = async (id) => {
    setIsLoading(true);
    await API.deleteEPG(id);
    setIsLoading(false);
    setConfirmDeleteOpen(false);
  };

  const refreshEPG = async (id) => {
    await API.refreshEPG(id);
    notifications.show({
      title: 'EPG refresh initiated',
    });
  };

  const closeEPGForm = () => {
    setEPG(null);
    setEPGModalOpen(false);
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    //scroll to the top of the table when the sorting changes
    try {
      rowVirtualizerInstanceRef.current?.scrollToIndex?.(0);
    } catch (error) {
      console.error(error);
    }
  }, [sorting]);

  const table = useMantineReactTable({
    ...TableHelper.defaultProperties,
    columns,
    // Sort data before passing to table: active first, then by name
    data: Object.values(epgs)
      .sort((a, b) => {
        // First sort by active status (active items first)
        if (a.is_active !== b.is_active) {
          return a.is_active ? -1 : 1;
        }
        // Then sort by name (case-insensitive)
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }),
    enablePagination: false,
    enableRowVirtualization: true,
    enableRowSelection: false,
    renderTopToolbar: false,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: {
      isLoading,
      sorting,
      rowSelection,
      density: tableDensity,
    },
    rowVirtualizerInstanceRef, //optional
    rowVirtualizerOptions: { overscan: 5 }, //optionally customize the row virtualizer
    initialState: {
      density: tableDensity,
    },
    enableRowActions: true,
    positionActionsColumn: 'last',
    displayColumnDefOptions: {
      'mrt-row-actions': {
        size: 120, // Make action column wider
        minSize: 120, // Ensure minimum width for action buttons
      },
    },
    renderRowActions: ({ row }) => (
      <>
        <ActionIcon
          variant="transparent"
          size={iconSize} // Use standardized icon size
          color="yellow.5" // Red color for delete actions
          onClick={() => editEPG(row.original)}
        >
          <SquarePen size={tableSize === 'compact' ? 16 : 18} /> {/* Small icon size */}
        </ActionIcon>
        <ActionIcon
          variant="transparent"
          size={iconSize} // Use standardized icon size
          color="red.9" // Red color for delete actions
          onClick={() => deleteEPG(row.original.id)}
        >
          <SquareMinus size={tableSize === 'compact' ? 16 : 18} /> {/* Small icon size */}
        </ActionIcon>
        <ActionIcon
          variant="transparent"
          size={iconSize} // Use standardized icon size
          color="blue.5" // Red color for delete actions
          onClick={() => refreshEPG(row.original.id)}
          disabled={!row.original.is_active}
        >
          <RefreshCcw size={tableSize === 'compact' ? 16 : 18} /> {/* Small icon size */}
        </ActionIcon>
      </>
    ),
    mantineTableContainerProps: {
      style: {
        height: 'calc(40vh - 10px)',
        overflowX: 'auto', // Ensure horizontal scrolling works
      },
    },
    mantineTableProps: {
      ...TableHelper.defaultProperties.mantineTableProps,
      className: `table-size-${tableSize}`,
    },
    // Add custom cell styles to match CustomTable's sizing
    mantineTableBodyCellProps: ({ cell }) => {
      // Check if this is a status message cell with active progress
      const progressData = cell.column.id === 'last_message' &&
        refreshProgress[cell.row.original.id] &&
        refreshProgress[cell.row.original.id].progress < 100 ?
        refreshProgress[cell.row.original.id] : null;

      // Only expand height for certain actions that need more space
      const needsExpandedHeight = progressData &&
        ['downloading', 'parsing_channels', 'parsing_programs'].includes(progressData.action);

      return {
        style: {
          // Apply taller height for progress cells (except initializing), otherwise use standard height
          height: needsExpandedHeight ? '80px' : (
            tableSize === 'compact' ? '28px' : tableSize === 'large' ? '48px' : '40px'
          ),
          fontSize: tableSize === 'compact' ? 'var(--mantine-font-size-xs)' : 'var(--mantine-font-size-sm)',
          padding: tableSize === 'compact' ? '2px 8px' : '4px 10px'
        }
      };
    },
  });

  return (
    <Box>
      <Flex
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingBottom: 10,
        }}
        gap={15}
      >
        <Text
          h={24}
          style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500,
            fontSize: '20px',
            lineHeight: 1,
            letterSpacing: '-0.3px',
            color: 'gray.6', // Adjust this to match MUI's theme.palette.text.secondary
            marginBottom: 0,
          }}
        >
          EPGs
        </Text>
      </Flex>

      <Paper
        style={{
          bgcolor: theme.palette.background.paper,
          borderRadius: 2,
        }}
      >
        {/* Top toolbar with Remove, Assign, Auto-match, and Add buttons */}
        <Box
          style={{
            display: 'flex',
            // alignItems: 'center',
            // backgroundColor: theme.palette.background.paper,
            justifyContent: 'flex-end',
            padding: 10,
            // gap: 1,
          }}
        >
          <Flex gap={6}>
            <Tooltip label="Assign">
              <Button
                leftSection={<IconSquarePlus size={18} />}
                variant="light"
                size="xs"
                onClick={() => editEPG()}
                p={5}
                color="green"
                style={{
                  borderWidth: '1px',
                  borderColor: 'green',
                  color: 'white',
                }}
              >
                Add EPG
              </Button>
            </Tooltip>
          </Flex>
        </Box>
      </Paper>

      <MantineReactTable table={table} />
      <EPGForm epg={epg} isOpen={epgModalOpen} onClose={closeEPGForm} />

      <ConfirmationDialog
        opened={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => executeDeleteEPG(deleteTarget)}
        title="Confirm EPG Source Deletion"
        message={
          epgToDelete ? (
            <div style={{ whiteSpace: 'pre-line' }}>
              {`Are you sure you want to delete the following EPG source?

Name: ${epgToDelete.name}
Source Type: ${epgToDelete.source_type}
${epgToDelete.url ? `URL: ${epgToDelete.url}` :
                  epgToDelete.api_key ? `API Key: ${epgToDelete.api_key}` :
                    epgToDelete.file_path ? `File Path: ${epgToDelete.file_path}` : ''}

This will remove all related program information and channel associations.
This action cannot be undone.`}
            </div>
          ) : (
            'Are you sure you want to delete this EPG source? This action cannot be undone.'
          )
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        actionKey="delete-epg"
        onSuppressChange={suppressWarning}
        size="lg"
      />
    </Box>
  );
};

export default EPGsTable;
