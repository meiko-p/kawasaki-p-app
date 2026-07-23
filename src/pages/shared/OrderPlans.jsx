import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../../supabaseClient.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const PRODUCT_TYPE_OPTIONS = [
  { value: 'ENGINE', label: '小型エンジン' },
  { value: 'OM', label: 'O/M' },
  { value: 'OTHER', label: 'その他' },
];

const DELIVERY_FACTORY_OPTIONS = [
  { value: '75', label: '75工場' },
  { value: '76', label: '76工場' },
  { value: '85', label: '85工場' },
  { value: '86', label: '86工場' },
];

const MAX_ITEMS_PER_PLAN = 5;

function createClientKey(prefix = 'draft') {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function emptyItemForm() {
  return {
    editingKey: '',
    itemId: null,
    productCode: '',
    productType: 'ENGINE',
    productName: '',
    printOrderQty: '',
    deliveryFactory: '',
    kawasakiOrderNo: '',
    memo: '',
  };
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createScheduleRow(initial = {}) {
  return {
    id: String(initial.id || createClientKey('line')),
    date: String(initial.date || ''),
    qty: initial.qty ?? '',
  };
}

function normalizeSchedule(raw) {
  let source = [];

  if (Array.isArray(raw)) {
    source = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      source = Array.isArray(parsed) ? parsed : [];
    } catch {
      source = [];
    }
  }

  const rows = source.map((row) =>
    createScheduleRow({
      id: row?.id,
      date: row?.date,
      qty: row?.qty ?? row?.quantity ?? '',
    }),
  );

  return rows.length > 0 ? rows : [createScheduleRow()];
}

function normalizeNumberText(value) {
  return String(value ?? '')
    .trim()
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[，,]/g, '');
}

function parseNonNegativeInteger(value) {
  const normalized = normalizeNumberText(value);
  if (!normalized) return 0;

  const match = normalized.match(/-?\d+/);
  const numeric = match ? Number(match[0]) : 0;
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function buildSchedulePayload(rows) {
  return (rows || [])
    .map((row) => {
      const date = String(row?.date || '').trim();
      const qtyText = normalizeNumberText(row?.qty);

      if (!date && !qtyText) return null;

      const match = qtyText.match(/-?\d+/);
      const qtyNumber = match ? Number(match[0]) : 0;
      const qty = Number.isFinite(qtyNumber)
        ? Math.max(0, Math.round(qtyNumber))
        : 0;

      return {
        id: String(row?.id || createClientKey('line')),
        date: date || null,
        qty,
      };
    })
    .filter(Boolean);
}

function formatDateJa(value) {
  if (!value) return '';

  const normalized = String(value).includes('T')
    ? String(value).split('T')[0]
    : String(value);

  const [year, month, day] = normalized.split('-');
  if (!year || !month || !day) return String(value);
  return `${year}/${month}/${day}`;
}

function productTypeLabel(value) {
  return (
    PRODUCT_TYPE_OPTIONS.find((option) => option.value === value)?.label ||
    value ||
    ''
  );
}

function factoryLabel(value) {
  return (
    DELIVERY_FACTORY_OPTIONS.find((option) => option.value === value)?.label ||
    value ||
    ''
  );
}

function safeFileName(name) {
  return String(name || 'plan-image').replace(/[\\/:*?"<>|]/g, '_');
}

function scheduleTotal(schedule) {
  return normalizeSchedule(schedule)
    .filter((row) => row.date || String(row.qty ?? '').trim())
    .reduce((sum, row) => {
      const match = normalizeNumberText(row.qty).match(/-?\d+/);
      const numeric = match ? Number(match[0]) : 0;
      return sum + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
}

function editorHasAnyValue(itemForm, deliveryRows) {
  return Boolean(
    String(itemForm.productCode || '').trim() ||
      String(itemForm.productName || '').trim() ||
      String(itemForm.printOrderQty || '').trim() ||
      String(itemForm.deliveryFactory || '').trim() ||
      String(itemForm.kawasakiOrderNo || '').trim() ||
      String(itemForm.memo || '').trim() ||
      buildSchedulePayload(deliveryRows).length > 0,
  );
}

function validateItemDraft(item) {
  const productCode = String(item.productCode || '').trim();
  const productName = String(item.productName || '').trim();
  const productType = String(item.productType || '').trim();

  if (!productCode || !productType || !productName) {
    throw new Error(
      '品番・商品種類・商品名の3項目をすべて入力してください。',
    );
  }

  if (!['ENGINE', 'OM', 'OTHER'].includes(productType)) {
    throw new Error(`商品種類が正しくありません（品番：${productCode}）。`);
  }

  const printOrderQty = parseNonNegativeInteger(item.printOrderQty);
  if (printOrderQty <= 0) {
    throw new Error(`印刷手配数を1以上で入力してください（品番：${productCode}）。`);
  }
}

function validateDraftCollection(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('品番明細を1件以上「入力中一覧へ追加」してください。');
  }

  if (items.length > MAX_ITEMS_PER_PLAN) {
    throw new Error(
      `1つの計画書に登録できる品番は最大${MAX_ITEMS_PER_PLAN}件です。`,
    );
  }

  items.forEach(validateItemDraft);

  const normalizedCodes = items.map((item) =>
    String(item.productCode || '').trim().toLowerCase(),
  );

  const duplicateCode = normalizedCodes.find(
    (code, index) => normalizedCodes.indexOf(code) !== index,
  );

  if (duplicateCode) {
    throw new Error('同じ計画書内に同一品番が重複しています。');
  }
}

async function createSignedUrl(path) {
  if (!path) return '';

  const { data, error } = await supabase.storage
    .from('app-files')
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[createSignedUrl]', error);
    return '';
  }

  return data?.signedUrl || '';
}

function toDraftItem(dbItem, index) {
  return {
    clientKey: createClientKey('loaded'),
    itemId: dbItem.id,
    productCode: dbItem.product?.product_code || '',
    productType: dbItem.product?.product_type || 'ENGINE',
    productName: dbItem.product?.name || '',
    printOrderQty: dbItem.print_order_qty ?? '',
    deliveryFactory: dbItem.delivery_factory || '',
    kawasakiOrderNo: dbItem.kawasaki_order_no || '',
    memo: dbItem.memo || '',
    deliverySchedule: normalizeSchedule(dbItem.delivery_schedule),
    sortOrder: dbItem.sort_order ?? index,
    dirty: false,
  };
}

export default function OrderPlans() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [planList, setPlanList] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [planDate, setPlanDate] = useState(todayIso());
  const [planTitle, setPlanTitle] = useState('計画書（発注）');
  const [planNote, setPlanNote] = useState('');

  const [currentImagePath, setCurrentImagePath] = useState('');
  const [currentImageUrl, setCurrentImageUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imageInputKey, setImageInputKey] = useState(0);
  const [localImageUrl, setLocalImageUrl] = useState('');
  const [imageZoom, setImageZoom] = useState(100);

  const [draftItems, setDraftItems] = useState([]);
  const [itemForm, setItemForm] = useState(emptyItemForm());
  const [deliveryRows, setDeliveryRows] = useState([createScheduleRow()]);
  const [expandedItemKey, setExpandedItemKey] = useState('');
  const [dirty, setDirty] = useState(false);

  /**
   * 未保存状態は state と ref の両方で保持します。
   * ref を使う理由：dirty が変わるたびに loadPlan の参照が変わると、
   * 初期読込 useEffect が再実行され、入力した文字や削除した明細が
   * DBの内容で上書きされてしまうためです。
   */
  const dirtyRef = useRef(false);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const markClean = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  // state が別経路から変更された場合にも ref を同期する保険です。
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const editorRef = useRef(null);
  const productCodeInputRef = useRef(null);
  const imageViewportRef = useRef(null);
  const uploadFolderKeyRef = useRef(createClientKey('plan'));

  const selectedPlan = useMemo(
    () => planList.find((plan) => plan.id === selectedPlanId) || null,
    [planList, selectedPlanId],
  );

  const displayedImageUrl = localImageUrl || currentImageUrl;

  const cleanDeliveryRows = useMemo(
    () => buildSchedulePayload(deliveryRows),
    [deliveryRows],
  );

  const isEditingDraft = Boolean(itemForm.editingKey);

  const hasEditorContent = useMemo(
    () => editorHasAnyValue(itemForm, deliveryRows),
    [itemForm, deliveryRows],
  );

  const currentTotalCount =
    draftItems.length + (hasEditorContent && !isEditingDraft ? 1 : 0);

  const canAddAnotherDraft =
    isEditingDraft || draftItems.length < MAX_ITEMS_PER_PLAN;

  const clearMessages = useCallback(() => {
    setError('');
    setSuccess('');
  }, []);

  const focusItemEditor = useCallback(() => {
    window.setTimeout(() => {
      editorRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      productCodeInputRef.current?.focus();
    }, 100);
  }, []);

  const resetItemEditor = useCallback(() => {
    setItemForm(emptyItemForm());
    setDeliveryRows([createScheduleRow()]);
    setExpandedItemKey('');
  }, []);

  const confirmDiscardIfDirty = useCallback(() => {
    if (!dirtyRef.current) return true;

    return window.confirm(
      'まだ「計画書セットをまとめて保存」していない変更があります。破棄して移動しますか？',
    );
  }, []);

  const resetPlanForm = useCallback(
    (force = false) => {
      if (!force && !confirmDiscardIfDirty()) return false;

      clearMessages();
      setSelectedPlanId('');
      setPlanDate(todayIso());
      setPlanTitle('計画書（発注）');
      setPlanNote('');
      setCurrentImagePath('');
      setCurrentImageUrl('');
      setImageFile(null);
      setImageInputKey((previous) => previous + 1);
      setImageZoom(100);
      setDraftItems([]);
      resetItemEditor();
      markClean();
      uploadFolderKeyRef.current = createClientKey('plan');

      return true;
    },
    [
      clearMessages,
      confirmDiscardIfDirty,
      markClean,
      resetItemEditor,
    ],
  );

  useEffect(() => {
    if (!imageFile) {
      setLocalImageUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setLocalImageUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile]);

  const loadPlanList = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('order_plans')
      .select(
        `
          id,
          plan_date,
          title,
          image_path,
          note,
          created_at,
          updated_at
        `,
      )
      .order('plan_date', { ascending: false })
      .order('updated_at', { ascending: false });

    if (fetchError) throw fetchError;

    setPlanList(data || []);
    return data || [];
  }, []);

  const loadPlan = useCallback(
    async (planId, options = {}) => {
      const { skipDirtyConfirm = false } = options;

      if (!skipDirtyConfirm && !confirmDiscardIfDirty()) {
        return false;
      }

      if (!planId) {
        resetPlanForm(true);
        return true;
      }

      setLoading(true);
      clearMessages();

      try {
        const [planResult, itemResult] = await Promise.all([
          supabase
            .from('order_plans')
            .select(
              `
                id,
                plan_date,
                title,
                image_path,
                note,
                created_at,
                updated_at
              `,
            )
            .eq('id', planId)
            .single(),

          supabase
            .from('order_plan_items')
            .select(
              `
                id,
                order_plan_id,
                product_id,
                print_order_qty,
                delivery_factory,
                kawasaki_order_no,
                delivery_schedule,
                memo,
                sort_order,
                created_at,
                updated_at,
                product:products (
                  id,
                  product_code,
                  name,
                  product_type,
                  active,
                  plan_registered
                )
              `,
            )
            .eq('order_plan_id', planId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true }),
        ]);

        if (planResult.error) throw planResult.error;
        if (itemResult.error) throw itemResult.error;

        const plan = planResult.data;
        const items = itemResult.data || [];

        setSelectedPlanId(plan.id);
        setPlanDate(plan.plan_date || todayIso());
        setPlanTitle(plan.title || '計画書（発注）');
        setPlanNote(plan.note || '');
        setCurrentImagePath(plan.image_path || '');
        setCurrentImageUrl(await createSignedUrl(plan.image_path));
        setImageFile(null);
        setImageInputKey((previous) => previous + 1);
        setImageZoom(100);
        setDraftItems(items.map(toDraftItem));
        resetItemEditor();
        markClean();
        uploadFolderKeyRef.current = plan.id;

        return true;
      } catch (loadError) {
        // eslint-disable-next-line no-console
        console.error(loadError);
        setError(loadError?.message || '計画書の読み込みに失敗しました。');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [
      clearMessages,
      confirmDiscardIfDirty,
      markClean,
      resetItemEditor,
      resetPlanForm,
    ],
  );

  /**
   * 初期読込。loadPlan は dirtyRef を参照する安定した関数なので、
   * 入力や削除で dirty が変化しても、この effect は再実行されません。
   */
  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);

      try {
        const list = await loadPlanList();
        if (!active) return;

        if (list.length > 0) {
          await loadPlan(list[0].id, { skipDirtyConfirm: true });
        }
      } catch (initialError) {
        if (!active) return;

        // eslint-disable-next-line no-console
        console.error(initialError);
        setError(initialError?.message || '計画書一覧の取得に失敗しました。');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadPlan, loadPlanList]);

  const addDeliveryRow = () => {
    setDeliveryRows((previous) => [...previous, createScheduleRow()]);
    markDirty();
  };

  const updateDeliveryRow = (id, patch) => {
    setDeliveryRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    markDirty();
  };

  const removeDeliveryRow = (id) => {
    setDeliveryRows((previous) => {
      const next = previous.filter((row) => row.id !== id);
      return next.length > 0 ? next : [createScheduleRow()];
    });
    markDirty();
  };

  const buildItemFromEditor = useCallback(() => {
    const draft = {
      clientKey: itemForm.editingKey || createClientKey('item'),
      itemId: itemForm.itemId || null,
      productCode: String(itemForm.productCode || '').trim(),
      productType: itemForm.productType || 'ENGINE',
      productName: String(itemForm.productName || '').trim(),
      printOrderQty: parseNonNegativeInteger(itemForm.printOrderQty),
      deliveryFactory: itemForm.deliveryFactory || '',
      kawasakiOrderNo: String(itemForm.kawasakiOrderNo || '').trim(),
      memo: String(itemForm.memo || '').trim(),
      deliverySchedule: deliveryRows.map((row) => ({ ...row })),
      dirty: true,
    };

    validateItemDraft(draft);
    return draft;
  }, [deliveryRows, itemForm]);

  const addOrUpdateDraft = () => {
    clearMessages();

    try {
      const draft = buildItemFromEditor();

      if (!isEditingDraft && draftItems.length >= MAX_ITEMS_PER_PLAN) {
        throw new Error(
          `1つの計画書に追加できる品番は最大${MAX_ITEMS_PER_PLAN}件です。`,
        );
      }

      const duplicate = draftItems.find(
        (item) =>
          item.clientKey !== draft.clientKey &&
          String(item.productCode || '').trim().toLowerCase() ===
            draft.productCode.toLowerCase(),
      );

      if (duplicate) {
        throw new Error('同じ計画書内に同一品番を2件追加できません。');
      }

      setDraftItems((previous) => {
        const existingIndex = previous.findIndex(
          (item) => item.clientKey === draft.clientKey,
        );

        if (existingIndex >= 0) {
          return previous.map((item, index) =>
            index === existingIndex
              ? { ...draft, sortOrder: existingIndex }
              : item,
          );
        }

        return [...previous, { ...draft, sortOrder: previous.length }];
      });

      resetItemEditor();
      markDirty();
      setSuccess(
        isEditingDraft
          ? '入力中一覧の明細を更新しました。まだSupabaseには保存されていません。'
          : '入力中一覧へ追加しました。続けて次の品番を入力できます。',
      );
      focusItemEditor();
    } catch (draftError) {
      setError(draftError?.message || '入力内容を確認してください。');
    }
  };

  const editDraft = (item) => {
    clearMessages();

    setItemForm({
      editingKey: item.clientKey,
      itemId: item.itemId || null,
      productCode: item.productCode,
      productType: item.productType,
      productName: item.productName,
      printOrderQty: String(item.printOrderQty ?? ''),
      deliveryFactory: item.deliveryFactory,
      kawasakiOrderNo: item.kawasakiOrderNo,
      memo: item.memo,
    });
    setDeliveryRows(normalizeSchedule(item.deliverySchedule));
    setExpandedItemKey(item.clientKey);
    focusItemEditor();
  };

  const removeDraft = (item) => {
    if (
      !window.confirm(
        `品番「${item.productCode}」を入力中一覧から削除します。\n最後にまとめて保存するとSupabase側からも削除されます。`,
      )
    ) {
      return;
    }

    setDraftItems((previous) =>
      previous.filter((row) => row.clientKey !== item.clientKey),
    );

    setExpandedItemKey((previous) =>
      previous === item.clientKey ? '' : previous,
    );

    if (itemForm.editingKey === item.clientKey) {
      resetItemEditor();
    }

    markDirty();
    setSuccess(
      '入力中一覧から削除しました。最後にまとめて保存してください。',
    );
  };

  const beginNextItem = () => {
    clearMessages();
    resetItemEditor();
    focusItemEditor();
  };

  const collectItemsForFinalSave = useCallback(() => {
    let nextItems = draftItems.map((item) => ({ ...item }));

    if (hasEditorContent) {
      const currentDraft = buildItemFromEditor();
      const existingIndex = nextItems.findIndex(
        (item) => item.clientKey === currentDraft.clientKey,
      );

      if (existingIndex >= 0) {
        nextItems = nextItems.map((item, index) =>
          index === existingIndex
            ? { ...currentDraft, sortOrder: existingIndex }
            : item,
        );
      } else {
        nextItems = [
          ...nextItems,
          { ...currentDraft, sortOrder: nextItems.length },
        ];
      }
    }

    nextItems = nextItems.map((item, index) => ({
      ...item,
      sortOrder: index,
    }));

    validateDraftCollection(nextItems);
    return nextItems;
  }, [buildItemFromEditor, draftItems, hasEditorContent]);

  const saveWholePlan = async () => {
    clearMessages();

    if (!planDate) {
      setError('計画書日付を入力してください。');
      return;
    }

    let itemsToSave;

    try {
      itemsToSave = collectItemsForFinalSave();
    } catch (validationError) {
      setError(validationError?.message || '入力内容を確認してください。');
      return;
    }

    setSavingAll(true);
    let newlyUploadedPath = '';

    try {
      let imagePath = currentImagePath || null;

      if (imageFile) {
        const folderKey = selectedPlanId || uploadFolderKeyRef.current;

        newlyUploadedPath =
          `shared/order-plans/${folderKey}/` +
          `${Date.now()}_${safeFileName(imageFile.name)}`;

        const { error: uploadError } = await supabase.storage
          .from('app-files')
          .upload(newlyUploadedPath, imageFile, {
            upsert: true,
            contentType: imageFile.type || 'image/jpeg',
          });

        if (uploadError) throw uploadError;
        imagePath = newlyUploadedPath;
      }

      const itemsPayload = itemsToSave.map((item, index) => ({
        itemId: item.itemId || null,
        productCode: String(item.productCode || '').trim(),
        productType: item.productType,
        productName: String(item.productName || '').trim(),
        printOrderQty: parseNonNegativeInteger(item.printOrderQty),
        deliveryFactory: item.deliveryFactory || null,
        kawasakiOrderNo:
          String(item.kawasakiOrderNo || '').trim() || null,
        memo: String(item.memo || '').trim() || null,
        deliverySchedule: buildSchedulePayload(item.deliverySchedule),
        sortOrder: index,
      }));

      const { data, error: rpcError } = await supabase.rpc(
        'save_order_plan_bundle',
        {
          p_plan_id: selectedPlanId || null,
          p_plan_date: planDate,
          p_title:
            String(planTitle || '').trim() || '計画書（発注）',
          p_note: String(planNote || '').trim() || null,
          p_image_path: imagePath,
          p_items: itemsPayload,
        },
      );

      if (rpcError) throw rpcError;

      const savedPlanId = data?.plan_id || selectedPlanId;

      if (!savedPlanId) {
        throw new Error('保存後の計画書IDを取得できませんでした。');
      }

      if (
        newlyUploadedPath &&
        currentImagePath &&
        currentImagePath !== newlyUploadedPath
      ) {
        const { error: oldImageDeleteError } = await supabase.storage
          .from('app-files')
          .remove([currentImagePath]);

        if (oldImageDeleteError) {
          // eslint-disable-next-line no-console
          console.warn('[old image cleanup]', oldImageDeleteError);
        }
      }

      setImageFile(null);
      setImageInputKey((previous) => previous + 1);
      resetItemEditor();
      markClean();

      await loadPlanList();
      await loadPlan(savedPlanId, { skipDirtyConfirm: true });

      setSuccess(
        `計画書画像・基本情報・${itemsPayload.length}件の品番明細を、1回でまとめて保存しました。`,
      );
    } catch (saveError) {
      if (newlyUploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from('app-files')
          .remove([newlyUploadedPath]);

        if (cleanupError) {
          // eslint-disable-next-line no-console
          console.warn('[failed upload cleanup]', cleanupError);
        }
      }

      // eslint-disable-next-line no-console
      console.error(saveError);
      setError(
        saveError?.message || '計画書セットの保存に失敗しました。',
      );
    } finally {
      setSavingAll(false);
    }
  };

  const deletePlan = async () => {
    if (!selectedPlanId) return;

    if (
      !window.confirm(
        `${planDate} の計画書を、登録品番を含めて削除します。よろしいですか？`,
      )
    ) {
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const { error: deleteError } = await supabase
        .from('order_plans')
        .delete()
        .eq('id', selectedPlanId);

      if (deleteError) throw deleteError;

      if (currentImagePath) {
        const { error: imageDeleteError } = await supabase.storage
          .from('app-files')
          .remove([currentImagePath]);

        if (imageDeleteError) {
          // eslint-disable-next-line no-console
          console.warn('[plan image cleanup]', imageDeleteError);
        }
      }

      const list = await loadPlanList();

      if (list.length > 0) {
        await loadPlan(list[0].id, { skipDirtyConfirm: true });
      } else {
        resetPlanForm(true);
      }

      setSuccess('計画書を削除しました。');
    } catch (deleteError) {
      // eslint-disable-next-line no-console
      console.error(deleteError);
      setError(deleteError?.message || '計画書の削除に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const zoomImage = (delta) => {
    setImageZoom((previous) =>
      Math.min(250, Math.max(50, previous + delta)),
    );
  };

  const scrollImageToTop = () => {
    imageViewportRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: 'smooth',
    });
  };

  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          alignItems={{ md: 'center' }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" fontWeight={900}>
              計画書（発注）【スタート】
            </Typography>
            <Typography
              variant="body2"
              sx={{ mt: 0.5, color: 'text.secondary' }}
            >
              計画書画像を見ながら最大{MAX_ITEMS_PER_PLAN}
              品番を入力し、最後に1つの保存ボタンで一括保存します。
            </Typography>
          </Box>

          <Chip
            color={dirty ? 'warning' : 'success'}
            variant="outlined"
            label={dirty ? '未保存の変更あり' : '保存済み'}
          />
          <Chip
            color={
              currentTotalCount >= MAX_ITEMS_PER_PLAN
                ? 'warning'
                : 'primary'
            }
            variant="outlined"
            label={`${currentTotalCount}/${MAX_ITEMS_PER_PLAN}品番`}
          />
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}

        {(loading || savingAll) && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2">
              {savingAll ? '計画書セットを一括保存中…' : '処理中…'}
            </Typography>
          </Stack>
        )}

        <Paper sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems={{ md: 'center' }}
          >
            <Box sx={{ minWidth: { md: 250 } }}>
              <Typography variant="h6" fontWeight={900}>
                ① 計画書セットを選択
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                日付を選ぶと、画像・基本情報・全品番を一式で呼び出します。
              </Typography>
            </Box>

            <FormControl fullWidth>
              <InputLabel id="saved-plan-label">保存済み日付</InputLabel>
              <Select
                labelId="saved-plan-label"
                label="保存済み日付"
                value={selectedPlanId}
                onChange={(event) => loadPlan(event.target.value)}
              >
                <MenuItem value="">
                  <em>新しい計画書を作成</em>
                </MenuItem>
                {planList.map((plan) => (
                  <MenuItem key={plan.id} value={plan.id}>
                    {formatDateJa(plan.plan_date)}　
                    {plan.title || '計画書（発注）'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              onClick={() => resetPlanForm(false)}
              sx={{ minWidth: 160 }}
            >
              新しい計画書
            </Button>

            <Button
              variant="outlined"
              color="error"
              onClick={deletePlan}
              disabled={!selectedPlanId || loading || savingAll}
              sx={{ minWidth: 150 }}
            >
              計画書を削除
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ md: 'center' }}
            >
              <Box sx={{ minWidth: { md: 250 } }}>
                <Typography variant="h6" fontWeight={900}>
                  ② 計画書の基本情報
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  ここでは保存しません。最後の一括保存ボタンで画像も含めて保存します。
                </Typography>
              </Box>

              <TextField
                type="date"
                label="計画書日付"
                value={planDate}
                onChange={(event) => {
                  setPlanDate(event.target.value);
                  markDirty();
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 210 }}
              />

              <TextField
                label="見出し"
                value={planTitle}
                onChange={(event) => {
                  setPlanTitle(event.target.value);
                  markDirty();
                }}
                placeholder="例：2026年7月 計画書（発注）"
                fullWidth
              />
            </Stack>

            <TextField
              label="計画書メモ（任意）"
              value={planNote}
              onChange={(event) => {
                setPlanNote(event.target.value);
                markDirty();
              }}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </Paper>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              lg: 'minmax(430px, 0.95fr) minmax(570px, 1.05fr)',
            },
            gap: 2,
            alignItems: 'start',
          }}
        >
          <Paper
            sx={{
              p: 1.5,
              position: { xs: 'static', lg: 'sticky' },
              top: { lg: 80 },
              zIndex: 2,
            }}
          >
            <Stack spacing={1.25}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ sm: 'center' }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={900}>
                    計画書を見ながら入力
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary' }}
                  >
                    左枠内だけスクロールできます。
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${imageZoom}%`}
                />
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => zoomImage(-25)}
                >
                  縮小
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setImageZoom(100)}
                >
                  全体幅
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => zoomImage(25)}
                >
                  拡大
                </Button>
                <Button
                  size="small"
                  variant="text"
                  onClick={scrollImageToTop}
                >
                  画像の先頭
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={!displayedImageUrl}
                  onClick={() => {
                    if (displayedImageUrl) {
                      window.open(
                        displayedImageUrl,
                        '_blank',
                        'noopener,noreferrer',
                      );
                    }
                  }}
                >
                  別タブで開く
                </Button>
              </Stack>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ sm: 'center' }}
              >
                <Button component="label" variant="outlined" size="small">
                  計画書写真を選択・撮影
                  <input
                    key={imageInputKey}
                    hidden
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => {
                      setImageFile(event.target.files?.[0] || null);
                      markDirty();
                    }}
                  />
                </Button>

                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary' }}
                >
                  {imageFile
                    ? `選択中：${imageFile.name}`
                    : currentImagePath
                      ? '保存済み画像を表示中'
                      : '画像未選択'}
                </Typography>
              </Stack>

              <Box
                ref={imageViewportRef}
                sx={{
                  height: {
                    xs: 520,
                    md: 620,
                    lg: 'calc(100vh - 250px)',
                  },
                  minHeight: { lg: 520 },
                  maxHeight: { lg: 850 },
                  overflow: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  bgcolor: '#e9edf2',
                }}
              >
                {displayedImageUrl ? (
                  <Box
                    sx={{
                      width: `${imageZoom}%`,
                      mx: imageZoom <= 100 ? 'auto' : 0,
                      bgcolor: '#fff',
                    }}
                  >
                    <img
                      src={displayedImageUrl}
                      alt="計画書"
                      style={{
                        display: 'block',
                        width: '100%',
                        height: 'auto',
                      }}
                    />
                  </Box>
                ) : (
                  <Stack
                    sx={{ height: '100%' }}
                    alignItems="center"
                    justifyContent="center"
                    spacing={1}
                  >
                    <Typography fontWeight={900} color="text.secondary">
                      計画書画像がありません
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      上のボタンから画像を選択してください。
                    </Typography>
                  </Stack>
                )}
              </Box>
            </Stack>
          </Paper>

          <Stack spacing={2}>
            <Paper sx={{ p: 1.5 }}>
              <Stack spacing={1.25}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ sm: 'center' }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h6" fontWeight={900}>
                      入力中の品番一覧
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: 'text.secondary' }}
                    >
                      ここに追加した段階ではSupabaseへ保存されません。最後にまとめて保存します。
                    </Typography>
                  </Box>

                  <Chip
                    label={`${draftItems.length}/${MAX_ITEMS_PER_PLAN}件`}
                    color={
                      draftItems.length >= MAX_ITEMS_PER_PLAN
                        ? 'warning'
                        : 'primary'
                    }
                    variant="outlined"
                  />

                  <Button
                    size="small"
                    variant="outlined"
                    onClick={beginNextItem}
                    disabled={
                      draftItems.length >= MAX_ITEMS_PER_PLAN &&
                      !isEditingDraft
                    }
                  >
                    次の品番を入力
                  </Button>
                </Stack>

                {draftItems.length === 0 ? (
                  <Alert severity="info">
                    右下の入力欄へ1品番目を入力し、「入力中一覧へ追加」を押してください。
                  </Alert>
                ) : (
                  <Stack spacing={1}>
                    {draftItems.map((item, index) => {
                      const schedule = normalizeSchedule(
                        item.deliverySchedule,
                      ).filter(
                        (row) =>
                          row.date || String(row.qty ?? '').trim(),
                      );

                      const expanded =
                        expandedItemKey === item.clientKey;
                      const editing =
                        itemForm.editingKey === item.clientKey;

                      return (
                        <Paper
                          key={item.clientKey}
                          variant="outlined"
                          sx={{
                            p: 1.25,
                            borderColor: editing
                              ? 'warning.main'
                              : 'divider',
                            bgcolor: editing
                              ? 'rgba(255, 167, 38, 0.06)'
                              : 'background.paper',
                          }}
                        >
                          <Stack spacing={1}>
                            <Stack
                              direction={{
                                xs: 'column',
                                md: 'row',
                              }}
                              spacing={1}
                              alignItems={{ md: 'center' }}
                            >
                              <Chip
                                size="small"
                                label={`品番 ${index + 1}`}
                                variant="outlined"
                              />

                              {item.itemId ? (
                                <Chip
                                  size="small"
                                  label={
                                    item.dirty
                                      ? '修正あり'
                                      : '保存済み'
                                  }
                                  color={
                                    item.dirty ? 'warning' : 'success'
                                  }
                                  variant="outlined"
                                />
                              ) : (
                                <Chip
                                  size="small"
                                  label="新規・未保存"
                                  color="warning"
                                  variant="outlined"
                                />
                              )}

                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography fontWeight={900} noWrap>
                                  {item.productCode || '-'}　
                                  {item.productName || '-'}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{ color: 'text.secondary' }}
                                >
                                  {productTypeLabel(item.productType)} / 印刷手配数：
                                  {parseNonNegativeInteger(item.printOrderQty).toLocaleString('ja-JP')}冊 /{' '}
                                  {factoryLabel(
                                    item.deliveryFactory,
                                  ) || '工場未設定'}{' '}
                                  / 注文番号：
                                  {item.kawasakiOrderNo || '未設定'} /
                                  納品予定：{schedule.length}件・合計
                                  {scheduleTotal(
                                    item.deliverySchedule,
                                  )}
                                  冊
                                </Typography>
                              </Box>

                              <Button
                                size="small"
                                variant="text"
                                onClick={() =>
                                  setExpandedItemKey((previous) =>
                                    previous === item.clientKey
                                      ? ''
                                      : item.clientKey,
                                  )
                                }
                              >
                                {expanded ? '詳細を閉じる' : '詳細'}
                              </Button>

                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => editDraft(item)}
                              >
                                修正
                              </Button>

                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                onClick={() => removeDraft(item)}
                              >
                                削除
                              </Button>
                            </Stack>

                            {expanded && (
                              <Box
                                sx={{
                                  p: 1,
                                  borderRadius: 1,
                                  bgcolor: 'background.default',
                                }}
                              >
                                <Typography variant="body2" sx={{ mb: 0.75 }}>
                                  <b>印刷手配数：</b>
                                  {parseNonNegativeInteger(item.printOrderQty).toLocaleString('ja-JP')}冊
                                </Typography>

                                {item.memo && (
                                  <Typography
                                    variant="body2"
                                    sx={{ mb: 0.75 }}
                                  >
                                    <b>メモ：</b>
                                    {item.memo}
                                  </Typography>
                                )}

                                {schedule.length === 0 ? (
                                  <Typography variant="body2">
                                    納品予定は未設定です。
                                  </Typography>
                                ) : (
                                  <Box
                                    sx={{
                                      display: 'grid',
                                      gridTemplateColumns:
                                        'repeat(2, minmax(0, 1fr))',
                                      gap: 0.75,
                                    }}
                                  >
                                    {schedule.map(
                                      (row, scheduleIndex) => (
                                        <Typography
                                          key={row.id}
                                          variant="body2"
                                          sx={{
                                            p: 0.75,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                          }}
                                        >
                                          {scheduleIndex + 1}.{' '}
                                          {formatDateJa(row.date) ||
                                            '日付未設定'}{' '}
                                          / {row.qty || 0}冊
                                        </Typography>
                                      ),
                                    )}
                                  </Box>
                                )}
                              </Box>
                            )}
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                )}
              </Stack>
            </Paper>

            <Paper ref={editorRef} sx={{ p: 2, scrollMarginTop: 90 }}>
              <Stack spacing={2}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  alignItems={{ md: 'center' }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h6" fontWeight={900}>
                      ③ 品番・納品情報を入力
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: 'text.secondary' }}
                    >
                      「入力中一覧へ追加」は画面内の仮登録です。DB保存は最後の1回だけです。
                    </Typography>
                  </Box>

                  <Chip
                    label={
                      isEditingDraft ? '一覧明細を修正中' : '新規明細'
                    }
                    color={isEditingDraft ? 'warning' : 'primary'}
                    variant="outlined"
                  />

                  <Button variant="text" onClick={beginNextItem}>
                    入力をクリア
                  </Button>
                </Stack>

                {!canAddAnotherDraft && (
                  <Alert severity="warning">
                    最大{MAX_ITEMS_PER_PLAN}
                    品番に達しています。既存明細を修正するか、いずれかを削除してください。
                  </Alert>
                )}

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      md: '1.15fr 0.85fr 1.15fr',
                    },
                    gap: 1.5,
                  }}
                >
                  <TextField
                    inputRef={productCodeInputRef}
                    label="品番【必須】"
                    value={itemForm.productCode}
                    onChange={(event) => {
                      setItemForm((previous) => ({
                        ...previous,
                        productCode: event.target.value,
                      }));
                      markDirty();
                    }}
                    placeholder="例：99817-0001"
                    disabled={!canAddAnotherDraft}
                  />

                  <FormControl disabled={!canAddAnotherDraft}>
                    <InputLabel id="plan-product-type-label">
                      商品種類【必須】
                    </InputLabel>
                    <Select
                      labelId="plan-product-type-label"
                      label="商品種類【必須】"
                      value={itemForm.productType}
                      onChange={(event) => {
                        setItemForm((previous) => ({
                          ...previous,
                          productType: event.target.value,
                        }));
                        markDirty();
                      }}
                    >
                      {PRODUCT_TYPE_OPTIONS.map((option) => (
                        <MenuItem
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    label="商品名【必須】"
                    value={itemForm.productName}
                    onChange={(event) => {
                      setItemForm((previous) => ({
                        ...previous,
                        productName: event.target.value,
                      }));
                      markDirty();
                    }}
                    placeholder="例：ZR900A / ZRT10G"
                    disabled={!canAddAnotherDraft}
                  />
                </Box>

                <TextField
                  label="印刷手配数【必須】"
                  value={itemForm.printOrderQty}
                  onChange={(event) => {
                    setItemForm((previous) => ({
                      ...previous,
                      printOrderQty: event.target.value,
                    }));
                    markDirty();
                  }}
                  placeholder="例：500"
                  helperText="この数量を見積画面の数量初期値と、在庫管理（納品完了）の基準在庫数へ自動反映します。"
                  inputProps={{ inputMode: 'numeric' }}
                  disabled={!canAddAnotherDraft}
                  fullWidth
                />

                <Divider />

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      md: '220px 1fr',
                    },
                    gap: 1.5,
                  }}
                >
                  <FormControl disabled={!canAddAnotherDraft}>
                    <InputLabel id="plan-factory-label">
                      納品工場
                    </InputLabel>
                    <Select
                      labelId="plan-factory-label"
                      label="納品工場"
                      value={itemForm.deliveryFactory}
                      onChange={(event) => {
                        setItemForm((previous) => ({
                          ...previous,
                          deliveryFactory: event.target.value,
                        }));
                        markDirty();
                      }}
                    >
                      <MenuItem value="">
                        <em>未設定</em>
                      </MenuItem>
                      {DELIVERY_FACTORY_OPTIONS.map((option) => (
                        <MenuItem
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    label="川崎重工 注文番号"
                    value={itemForm.kawasakiOrderNo}
                    onChange={(event) => {
                      setItemForm((previous) => ({
                        ...previous,
                        kawasakiOrderNo: event.target.value,
                      }));
                      markDirty();
                    }}
                    placeholder="例：KJ0001"
                    disabled={!canAddAnotherDraft}
                  />
                </Box>

                <TextField
                  label="明細メモ（任意）"
                  value={itemForm.memo}
                  onChange={(event) => {
                    setItemForm((previous) => ({
                      ...previous,
                      memo: event.target.value,
                    }));
                    markDirty();
                  }}
                  multiline
                  minRows={2}
                  fullWidth
                  disabled={!canAddAnotherDraft}
                />

                <Divider />

                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  alignItems={{ md: 'center' }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight={900}>
                      納品予定（追加数は無制限）
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: 'text.secondary' }}
                    >
                      この枠内だけスクロールします。
                    </Typography>
                  </Box>

                  <Chip
                    size="small"
                    label={`入力中 ${cleanDeliveryRows.length}件`}
                    variant="outlined"
                  />

                  <Button
                    variant="outlined"
                    onClick={addDeliveryRow}
                    disabled={!canAddAnotherDraft}
                  >
                    納品予定を追加
                  </Button>
                </Stack>

                <Box
                  sx={{
                    maxHeight: 430,
                    overflowY: 'auto',
                    pr: 0.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    p: 1,
                    bgcolor: 'background.default',
                  }}
                >
                  <Stack spacing={1}>
                    {deliveryRows.map((row, index) => (
                      <Paper
                        key={row.id}
                        variant="outlined"
                        sx={{ p: 1 }}
                      >
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: {
                              xs: '1fr',
                              sm: '52px minmax(180px, 1fr) minmax(150px, 0.75fr) 76px',
                            },
                            gap: 1,
                            alignItems: 'center',
                          }}
                        >
                          <Typography
                            variant="body2"
                            fontWeight={900}
                            sx={{ textAlign: { sm: 'center' } }}
                          >
                            {index + 1}
                          </Typography>

                          <TextField
                            type="date"
                            label={`納品日 ${index + 1}`}
                            value={row.date}
                            onChange={(event) =>
                              updateDeliveryRow(row.id, {
                                date: event.target.value,
                              })
                            }
                            InputLabelProps={{ shrink: true }}
                            size="small"
                            disabled={!canAddAnotherDraft}
                          />

                          <TextField
                            label={`納品数量 ${index + 1}`}
                            value={row.qty}
                            onChange={(event) =>
                              updateDeliveryRow(row.id, {
                                qty: event.target.value,
                              })
                            }
                            placeholder="例：100"
                            size="small"
                            disabled={!canAddAnotherDraft}
                          />

                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => removeDeliveryRow(row.id)}
                            disabled={!canAddAnotherDraft}
                          >
                            削除
                          </Button>
                        </Box>
                      </Paper>
                    ))}

                    <Button
                      variant="outlined"
                      onClick={addDeliveryRow}
                      disabled={!canAddAnotherDraft}
                    >
                      ＋ 納品予定をもう1件追加
                    </Button>
                  </Stack>
                </Box>

                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ sm: 'center' }}
                >
                  <Button
                    variant="outlined"
                    onClick={addOrUpdateDraft}
                    disabled={!canAddAnotherDraft}
                  >
                    {isEditingDraft
                      ? '入力中一覧の明細を更新'
                      : '入力中一覧へ追加して次の品番へ'}
                  </Button>

                  <Typography
                    variant="body2"
                    sx={{ color: 'text.secondary' }}
                  >
                    これは仮追加です。Supabase保存は下の水色ボタン1回だけです。
                  </Typography>
                </Stack>
              </Stack>
            </Paper>

            <Paper
              sx={{
                p: 2,
                position: 'sticky',
                bottom: 12,
                zIndex: 3,
                border: '1px solid',
                borderColor: dirty ? 'warning.main' : 'primary.main',
                boxShadow: 6,
              }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.5}
                alignItems={{ md: 'center' }}
              >
                <Button
                  variant="contained"
                  size="large"
                  onClick={saveWholePlan}
                  disabled={savingAll || loading}
                  sx={{
                    minWidth: 280,
                    py: 1.4,
                    fontWeight: 900,
                  }}
                >
                  {savingAll
                    ? '一括保存中…'
                    : '①〜③を計画書セットとしてまとめて保存'}
                </Button>

                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={900}>
                    保存対象：画像・基本情報・品番明細
                    {draftItems.length}件
                    {hasEditorContent ? '＋現在入力中の1件' : ''}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: 'text.secondary' }}
                  >
                    現在の入力欄に完成した品番が残っている場合は、その1件も自動で含めます。
                  </Typography>
                </Box>
              </Stack>
            </Paper>

            {selectedPlan && (
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary' }}
              >
                選択中セット：{formatDateJa(selectedPlan.plan_date)} /
                更新日時：
                {selectedPlan.updated_at
                  ? new Date(selectedPlan.updated_at).toLocaleString(
                      'ja-JP',
                    )
                  : '-'}
              </Typography>
            )}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
