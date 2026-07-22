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

/**
 * 1枚の計画書に登録する品番数の上限。
 * 今回の運用要件に合わせて5件にしています。
 * 将来6件以上必要になった場合は、この数字だけ変更してください。
 */
const MAX_ITEMS_PER_PLAN = 5;

const EMPTY_ITEM = {
  itemId: null,
  productCode: '',
  productType: 'ENGINE',
  productName: '',
  deliveryFactory: '',
  kawasakiOrderNo: '',
  memo: '',
};

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function newScheduleLine(initial = {}) {
  const generatedId =
    globalThis.crypto?.randomUUID?.() ||
    `line-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    id: String(initial.id || generatedId),
    date: String(initial.date || ''),
    qty: initial.qty ?? '',
  };
}

function normalizeSchedule(raw) {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  const rows = source.map((row) =>
    newScheduleLine({
      id: row?.id,
      date: row?.date,
      qty: row?.qty ?? row?.quantity ?? '',
    }),
  );

  return rows.length > 0 ? rows : [newScheduleLine()];
}

function buildSchedulePayload(rows) {
  return (rows || [])
    .map((row) => {
      const date = String(row?.date || '').trim();
      const qtyText = String(row?.qty ?? '').trim().replace(/,/g, '');

      if (!date && !qtyText) return null;

      const numericText = qtyText.replace(/[^\d-]/g, '');
      const qtyNumber = Number(numericText);
      const qty = Number.isFinite(qtyNumber)
        ? Math.max(0, Math.round(qtyNumber))
        : 0;

      return {
        id: String(row?.id || newScheduleLine().id),
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

  if (!year || !month || !day) {
    return String(value);
  }

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
      const numeric = Number(String(row.qty ?? '').replace(/,/g, ''));
      return sum + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
}

async function createSignedUrl(path) {
  if (!path) return '';

  const { data, error } = await supabase.storage
    .from('app-files')
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (error) {
    console.error('[createSignedUrl]', error);
    return '';
  }

  return data?.signedUrl || '';
}

export default function OrderPlans() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
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

  const [items, setItems] = useState([]);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [deliveryRows, setDeliveryRows] = useState([
    newScheduleLine(),
  ]);
  const [expandedItemId, setExpandedItemId] = useState('');

  const editorRef = useRef(null);
  const productCodeInputRef = useRef(null);
  const imageViewportRef = useRef(null);

  const selectedPlan = useMemo(
    () =>
      planList.find((plan) => plan.id === selectedPlanId) || null,
    [planList, selectedPlanId],
  );

  const cleanDeliveryRows = useMemo(
    () => buildSchedulePayload(deliveryRows),
    [deliveryRows],
  );

  const displayedImageUrl = localImageUrl || currentImageUrl;

  const isEditingItem = Boolean(itemForm.itemId);

  const canAddNewItem =
    isEditingItem || items.length < MAX_ITEMS_PER_PLAN;

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

  const resetItemForm = useCallback(() => {
    setItemForm(EMPTY_ITEM);
    setDeliveryRows([newScheduleLine()]);
    setExpandedItemId('');
  }, []);

  const resetPlanForm = useCallback(() => {
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

    setItems([]);
    resetItemForm();
  }, [clearMessages, resetItemForm]);

  /**
   * 選択直後の画像を画面へプレビューします。
   * 画像を変更した場合は以前のObject URLを解放します。
   */
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
      .order('plan_date', { ascending: false });

    if (fetchError) {
      throw fetchError;
    }

    setPlanList(data || []);

    return data || [];
  }, []);

  const loadPlan = useCallback(
    async (planId) => {
      if (!planId) {
        resetPlanForm();
        return;
      }

      setLoading(true);
      clearMessages();

      try {
        const [
          { data: plan, error: planError },
          { data: planItems, error: itemError },
        ] = await Promise.all([
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

        if (planError) {
          throw planError;
        }

        if (itemError) {
          throw itemError;
        }

        setSelectedPlanId(plan.id);
        setPlanDate(plan.plan_date || todayIso());
        setPlanTitle(plan.title || '計画書（発注）');
        setPlanNote(plan.note || '');

        setCurrentImagePath(plan.image_path || '');
        setCurrentImageUrl(
          await createSignedUrl(plan.image_path),
        );

        setImageFile(null);
        setImageInputKey((previous) => previous + 1);
        setImageZoom(100);

        setItems(planItems || []);
        setExpandedItemId('');

        resetItemForm();
      } catch (loadError) {
        console.error(loadError);

        setError(
          loadError?.message ||
            '計画書の読み込みに失敗しました',
        );
      } finally {
        setLoading(false);
      }
    },
    [
      clearMessages,
      resetItemForm,
      resetPlanForm,
    ],
  );

  /**
   * 最初の画面表示時に、
   * 最新の計画書を自動的に読み込みます。
   */
  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);

      try {
        const list = await loadPlanList();

        if (!active) return;

        if (list.length > 0) {
          await loadPlan(list[0].id);
        }
      } catch (initialError) {
        if (!active) return;

        console.error(initialError);

        setError(
          initialError?.message ||
            '計画書一覧の取得に失敗しました',
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loadPlan, loadPlanList]);

  /**
   * 計画書のヘッダを確定します。
   * 新規の場合はplan_dateをキーに作成し、
   * 既存の場合は選択中IDを更新します。
   */
  const ensurePlanSaved = useCallback(async () => {
    if (!planDate) {
      throw new Error(
        '計画書の日付を入力してください',
      );
    }

    const payload = {
      plan_date: planDate,

      title:
        String(
          planTitle || '計画書（発注）',
        ).trim() || '計画書（発注）',

      note:
        String(planNote || '').trim() || null,

      updated_by: user?.id || null,
    };

    let saved;

    if (selectedPlanId) {
      const { data, error: updateError } =
        await supabase
          .from('order_plans')
          .update(payload)
          .eq('id', selectedPlanId)
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
          .single();

      if (updateError) {
        throw updateError;
      }

      saved = data;
    } else {
      const { data, error: upsertError } =
        await supabase
          .from('order_plans')
          .upsert(
            {
              ...payload,
              created_by: user?.id || null,
            },
            {
              onConflict: 'plan_date',
            },
          )
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
          .single();

      if (upsertError) {
        throw upsertError;
      }

      saved = data;
    }

    setSelectedPlanId(saved.id);

    setCurrentImagePath(
      saved.image_path ||
        currentImagePath ||
        '',
    );

    return saved;
  }, [
    currentImagePath,
    planDate,
    planNote,
    planTitle,
    selectedPlanId,
    user?.id,
  ]);

  /**
   * 計画書ヘッダと画像を保存します。
   *
   * 「手配追加」を押した場合も、
   * この処理を先に実行します。
   *
   * そのため、
   * ・計画書日付
   * ・画像
   * ・見出し
   * ・計画書メモ
   * ・品番明細
   *
   * が同じ計画書セットに保存されます。
   */
  const persistPlanHeaderAndPhoto =
    useCallback(async () => {
      const savedPlan = await ensurePlanSaved();

      let imagePath =
        savedPlan.image_path ||
        currentImagePath ||
        null;

      if (imageFile) {
        const path =
          `shared/order-plans/` +
          `${savedPlan.id}/` +
          `${Date.now()}_` +
          `${safeFileName(imageFile.name)}`;

        const { error: uploadError } =
          await supabase.storage
            .from('app-files')
            .upload(path, imageFile, {
              upsert: true,
              contentType:
                imageFile.type ||
                'image/jpeg',
            });

        if (uploadError) {
          throw uploadError;
        }

        imagePath = path;
      }

      const {
        data: updatedPlan,
        error: updateError,
      } = await supabase
        .from('order_plans')
        .update({
          image_path: imagePath,
          updated_by: user?.id || null,
        })
        .eq('id', savedPlan.id)
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
        .single();

      if (updateError) {
        throw updateError;
      }

      setCurrentImagePath(
        updatedPlan.image_path || '',
      );

      setCurrentImageUrl(
        await createSignedUrl(
          updatedPlan.image_path,
        ),
      );

      setImageFile(null);
      setImageInputKey(
        (previous) => previous + 1,
      );

      await loadPlanList();

      return updatedPlan;
    }, [
      currentImagePath,
      ensurePlanSaved,
      imageFile,
      loadPlanList,
      user?.id,
    ]);

  const savePlanHeaderAndPhoto = async () => {
    setSavingPlan(true);
    clearMessages();

    try {
      await persistPlanHeaderAndPhoto();

      setSuccess(
        '計画書の日付・画像・メモを保存しました',
      );
    } catch (saveError) {
      console.error(saveError);

      setError(
        saveError?.message ||
          '計画書の保存に失敗しました',
      );
    } finally {
      setSavingPlan(false);
    }
  };

  const addDeliveryRow = () => {
    setDeliveryRows((previous) => [
      ...previous,
      newScheduleLine(),
    ]);
  };

  const updateDeliveryRow = (id, patch) => {
    setDeliveryRows((previous) =>
      previous.map((row) =>
        row.id === id
          ? {
              ...row,
              ...patch,
            }
          : row,
      ),
    );
  };

  const removeDeliveryRow = (id) => {
    setDeliveryRows((previous) => {
      const next = previous.filter(
        (row) => row.id !== id,
      );

      return next.length > 0
        ? next
        : [newScheduleLine()];
    });
  };

  /**
   * 品番・納品予定を保存します。
   *
   * 保存時に計画書ヘッダと画像も保存するため、
   * 計画書セットとして一括で紐づきます。
   */
  const saveItem = async () => {
    const code = String(
      itemForm.productCode || '',
    ).trim();

    const name = String(
      itemForm.productName || '',
    ).trim();

    if (
      !code ||
      !itemForm.productType ||
      !name
    ) {
      setError(
        '品番・商品種類・商品名の3項目をすべて入力してください',
      );
      return;
    }

    if (
      !isEditingItem &&
      items.length >= MAX_ITEMS_PER_PLAN
    ) {
      setError(
        `1枚の計画書に登録できる品番は最大${MAX_ITEMS_PER_PLAN}件です。` +
          '既存明細を修正するか、別の日付の計画書を作成してください。',
      );
      return;
    }

    setSavingItem(true);
    clearMessages();

    const wasEditing =
      Boolean(itemForm.itemId);

    try {
      const savedPlan =
        await persistPlanHeaderAndPhoto();

      const existingItem =
        itemForm.itemId
          ? items.find(
              (item) =>
                item.id === itemForm.itemId,
            )
          : null;

      const { error: rpcError } =
        await supabase.rpc(
          'save_order_plan_item',
          {
            p_order_plan_id: savedPlan.id,

            p_item_id:
              itemForm.itemId || null,

            p_product_code: code,

            p_product_type:
              itemForm.productType,

            p_product_name: name,

            p_delivery_factory:
              itemForm.deliveryFactory ||
              null,

            p_kawasaki_order_no:
              String(
                itemForm.kawasakiOrderNo ||
                  '',
              ).trim() || null,

            p_delivery_schedule:
              cleanDeliveryRows,

            p_memo:
              String(
                itemForm.memo || '',
              ).trim() || null,

            p_sort_order:
              existingItem?.sort_order ??
              items.length,
          },
        );

      if (rpcError) {
        throw rpcError;
      }

      await loadPlanList();
      await loadPlan(savedPlan.id);

      setSuccess(
        wasEditing
          ? '手配明細を更新しました。計画書セットへ反映済みです。'
          : '手配明細を追加しました。入力欄を空にしたので、続けて次の品番を入力できます。',
      );

      focusItemEditor();
    } catch (saveError) {
      console.error(saveError);

      setError(
        saveError?.message ||
          '手配明細の保存に失敗しました',
      );
    } finally {
      setSavingItem(false);
    }
  };

  const editItem = (item) => {
    clearMessages();

    setItemForm({
      itemId: item.id,

      productCode:
        item.product?.product_code || '',

      productType:
        item.product?.product_type ||
        'ENGINE',

      productName:
        item.product?.name || '',

      deliveryFactory:
        item.delivery_factory || '',

      kawasakiOrderNo:
        item.kawasaki_order_no || '',

      memo: item.memo || '',
    });

    setDeliveryRows(
      normalizeSchedule(
        item.delivery_schedule,
      ),
    );

    setExpandedItemId(item.id);

    focusItemEditor();
  };

  const deleteItem = async (item) => {
    const code =
      item.product?.product_code || '';

    if (
      !window.confirm(
        `品番「${code}」の手配明細を削除します。よろしいですか？`,
      )
    ) {
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const { error: deleteError } =
        await supabase
          .from('order_plan_items')
          .delete()
          .eq('id', item.id);

      if (deleteError) {
        throw deleteError;
      }

      if (itemForm.itemId === item.id) {
        resetItemForm();
      }

      await loadPlan(selectedPlanId);

      setSuccess(
        '手配明細を削除しました',
      );
    } catch (deleteError) {
      console.error(deleteError);

      setError(
        deleteError?.message ||
          '手配明細の削除に失敗しました',
      );
    } finally {
      setLoading(false);
    }
  };

  const deletePlan = async () => {
    if (!selectedPlanId) return;

    if (
      !window.confirm(
        `${planDate} の計画書を明細ごと削除します。よろしいですか？`,
      )
    ) {
      return;
    }

    setLoading(true);
    clearMessages();

    try {
      const { error: deleteError } =
        await supabase
          .from('order_plans')
          .delete()
          .eq('id', selectedPlanId);

      if (deleteError) {
        throw deleteError;
      }

      const list =
        await loadPlanList();

      if (list.length > 0) {
        await loadPlan(list[0].id);
      } else {
        resetPlanForm();
      }

      setSuccess(
        '計画書を削除しました',
      );
    } catch (deleteError) {
      console.error(deleteError);

      setError(
        deleteError?.message ||
          '計画書の削除に失敗しました',
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * 現在の編集を解除し、
   * 次の商品入力用の空フォームへ戻します。
   */
  const beginNextItem = () => {
    clearMessages();
    resetItemForm();
    focusItemEditor();
  };

  const zoomImage = (delta) => {
    setImageZoom((previous) =>
      Math.min(
        250,
        Math.max(50, previous + delta),
      ),
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
    <Box
      sx={{
        p: {
          xs: 1,
          md: 2,
        },
      }}
    >
      <Stack spacing={2}>
        {/* ページ見出し */}
        <Box>
          <Stack
            direction={{
              xs: 'column',
              md: 'row',
            }}
            spacing={1}
            alignItems={{
              md: 'center',
            }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="h4"
                fontWeight={900}
              >
                計画書（発注）【スタート】
              </Typography>

              <Typography
                variant="body2"
                sx={{
                  mt: 0.5,
                  color: 'text.secondary',
                }}
              >
                計画書画像を左に固定表示しながら、右側で最大
                {MAX_ITEMS_PER_PLAN}
                品番と各品番の納品予定を入力します。
              </Typography>
            </Box>

            <Chip
              color={
                items.length >=
                MAX_ITEMS_PER_PLAN
                  ? 'warning'
                  : 'primary'
              }
              variant="outlined"
              label={
                `選択中の計画書：` +
                `${items.length}/` +
                `${MAX_ITEMS_PER_PLAN}品番`
              }
            />
          </Stack>
        </Box>

        {error && (
          <Alert severity="error">
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success">
            {success}
          </Alert>
        )}

        {loading && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
          >
            <CircularProgress size={18} />

            <Typography variant="body2">
              処理中…
            </Typography>
          </Stack>
        )}

        {/* ① 計画書セット選択 */}
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack
              direction={{
                xs: 'column',
                md: 'row',
              }}
              spacing={2}
              alignItems={{
                md: 'center',
              }}
            >
              <Box
                sx={{
                  minWidth: {
                    md: 240,
                  },
                }}
              >
                <Typography
                  variant="h6"
                  fontWeight={900}
                >
                  ① 計画書セットを選択
                </Typography>

                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  日付を選ぶと、画像と登録済み品番を一式で呼び出します。
                </Typography>
              </Box>

              <FormControl fullWidth>
                <InputLabel id="saved-plan-label">
                  保存済み日付
                </InputLabel>

                <Select
                  labelId="saved-plan-label"
                  label="保存済み日付"
                  value={selectedPlanId}
                  onChange={(event) =>
                    loadPlan(
                      event.target.value,
                    )
                  }
                >
                  <MenuItem value="">
                    <em>
                      新しい計画書を作成
                    </em>
                  </MenuItem>

                  {planList.map((plan) => (
                    <MenuItem
                      key={plan.id}
                      value={plan.id}
                    >
                      {formatDateJa(
                        plan.plan_date,
                      )}
                      　
                      {plan.title ||
                        '計画書（発注）'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button
                variant="outlined"
                onClick={resetPlanForm}
                sx={{
                  minWidth: 160,
                }}
              >
                新しい計画書
              </Button>

              <Button
                variant="outlined"
                color="error"
                onClick={deletePlan}
                disabled={
                  !selectedPlanId ||
                  loading
                }
                sx={{
                  minWidth: 150,
                }}
              >
                計画書を削除
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {/* ② 計画書基本情報 */}
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack
              direction={{
                xs: 'column',
                md: 'row',
              }}
              spacing={2}
              alignItems={{
                md: 'center',
              }}
            >
              <Box
                sx={{
                  minWidth: {
                    md: 240,
                  },
                }}
              >
                <Typography
                  variant="h6"
                  fontWeight={900}
                >
                  ② 計画書の基本情報
                </Typography>

                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  「手配追加」を押した場合も、この内容と画像を同時保存します。
                </Typography>
              </Box>

              <TextField
                type="date"
                label="計画書日付"
                value={planDate}
                onChange={(event) =>
                  setPlanDate(
                    event.target.value,
                  )
                }
                InputLabelProps={{
                  shrink: true,
                }}
                sx={{
                  minWidth: 210,
                }}
              />

              <TextField
                label="見出し"
                value={planTitle}
                onChange={(event) =>
                  setPlanTitle(
                    event.target.value,
                  )
                }
                placeholder="例：2026年7月 計画書（発注）"
                fullWidth
              />
            </Stack>

            <TextField
              label="計画書メモ（任意）"
              value={planNote}
              onChange={(event) =>
                setPlanNote(
                  event.target.value,
                )
              }
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </Paper>

        {/* メインワークスペース */}
        <Box
          sx={{
            display: 'grid',

            gridTemplateColumns: {
              xs: '1fr',

              lg:
                'minmax(420px, 0.95fr) ' +
                'minmax(560px, 1.05fr)',
            },

            gap: 2,

            alignItems: 'start',
          }}
        >
          {/* 左：計画書画像 */}
          <Paper
            sx={{
              p: 1.5,

              position: {
                xs: 'static',
                lg: 'sticky',
              },

              /**
               * TopBarの高さに合わせた固定位置です。
               * 帯の高さを変更している場合は、
               * 80を90などへ調整してください。
               */
              top: {
                lg: 80,
              },

              zIndex: 2,
            }}
          >
            <Stack spacing={1.25}>
              <Stack
                direction={{
                  xs: 'column',
                  sm: 'row',
                }}
                spacing={1}
                alignItems={{
                  sm: 'center',
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={900}>
                    計画書を見ながら入力
                  </Typography>

                  <Typography
                    variant="caption"
                    sx={{
                      color:
                        'text.secondary',
                    }}
                  >
                    左枠内だけをスクロールできるため、右の入力欄を移動しても画像が残ります。
                  </Typography>
                </Box>

                <Chip
                  size="small"
                  variant="outlined"
                  label={`${imageZoom}%`}
                />
              </Stack>

              {/* 画像操作 */}
              <Stack
                direction="row"
                spacing={1}
                flexWrap="wrap"
              >
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    zoomImage(-25)
                  }
                >
                  縮小
                </Button>

                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    setImageZoom(100)
                  }
                >
                  全体幅
                </Button>

                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    zoomImage(25)
                  }
                >
                  拡大
                </Button>

                <Button
                  size="small"
                  variant="text"
                  onClick={
                    scrollImageToTop
                  }
                >
                  画像の先頭
                </Button>

                <Button
                  size="small"
                  variant="text"
                  disabled={
                    !displayedImageUrl
                  }
                  onClick={() => {
                    if (
                      displayedImageUrl
                    ) {
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

              {/* 画像選択・保存 */}
              <Stack
                direction={{
                  xs: 'column',
                  sm: 'row',
                }}
                spacing={1}
                alignItems={{
                  sm: 'center',
                }}
              >
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                >
                  計画書写真を選択・撮影

                  <input
                    key={imageInputKey}
                    hidden
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) =>
                      setImageFile(
                        event.target
                          .files?.[0] ||
                          null,
                      )
                    }
                  />
                </Button>

                <Button
                  variant="contained"
                  size="small"
                  onClick={
                    savePlanHeaderAndPhoto
                  }
                  disabled={
                    savingPlan || loading
                  }
                >
                  {savingPlan
                    ? '保存中…'
                    : '画像・基本情報を保存'}
                </Button>
              </Stack>

              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {imageFile
                  ? `選択中：${imageFile.name}`
                  : currentImagePath
                    ? '保存済み画像を表示中'
                    : '画像未選択'}
              </Typography>

              {/* 画像ビューア */}
              <Box
                ref={imageViewportRef}
                sx={{
                  height: {
                    xs: 520,
                    md: 620,

                    lg:
                      'calc(100vh - 285px)',
                  },

                  minHeight: {
                    lg: 520,
                  },

                  maxHeight: {
                    lg: 820,
                  },

                  overflow: 'auto',

                  border: '1px solid',

                  borderColor:
                    'divider',

                  borderRadius: 1.5,

                  bgcolor: '#e9edf2',
                }}
              >
                {displayedImageUrl ? (
                  <Box
                    sx={{
                      width:
                        `${imageZoom}%`,

                      mx:
                        imageZoom <= 100
                          ? 'auto'
                          : 0,

                      bgcolor: '#fff',
                    }}
                  >
                    <img
                      src={
                        displayedImageUrl
                      }
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
                    sx={{
                      height: '100%',
                    }}
                    alignItems="center"
                    justifyContent="center"
                    spacing={1}
                  >
                    <Typography
                      fontWeight={900}
                      color="text.secondary"
                    >
                      計画書画像がありません
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                    >
                      上の「計画書写真を選択・撮影」から画像を選択してください。
                    </Typography>
                  </Stack>
                )}
              </Box>
            </Stack>
          </Paper>

          {/* 右：保存済み品番＋入力欄 */}
          <Stack spacing={2}>
            {/* 保存済み品番 */}
            <Paper sx={{ p: 1.5 }}>
              <Stack spacing={1.25}>
                <Stack
                  direction={{
                    xs: 'column',
                    sm: 'row',
                  }}
                  spacing={1}
                  alignItems={{
                    sm: 'center',
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      variant="h6"
                      fontWeight={900}
                    >
                      登録済み品番
                      （計画書セット）
                    </Typography>

                    <Typography
                      variant="body2"
                      sx={{
                        color:
                          'text.secondary',
                      }}
                    >
                      保存後は1行に畳まれるため、次の品番入力を邪魔しません。
                    </Typography>
                  </Box>

                  <Chip
                    label={
                      `${items.length}/` +
                      `${MAX_ITEMS_PER_PLAN}件`
                    }
                    color={
                      items.length >=
                      MAX_ITEMS_PER_PLAN
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
                      items.length >=
                        MAX_ITEMS_PER_PLAN &&
                      !isEditingItem
                    }
                  >
                    次の品番を入力
                  </Button>
                </Stack>

                {items.length === 0 ? (
                  <Alert severity="info">
                    この計画書には、まだ品番が登録されていません。
                  </Alert>
                ) : (
                  <Stack spacing={1}>
                    {items.map(
                      (item, index) => {
                        const schedule =
                          normalizeSchedule(
                            item.delivery_schedule,
                          ).filter(
                            (row) =>
                              row.date ||
                              String(
                                row.qty ?? '',
                              ).trim(),
                          );

                        const expanded =
                          expandedItemId ===
                          item.id;

                        const editing =
                          itemForm.itemId ===
                          item.id;

                        return (
                          <Paper
                            key={item.id}
                            variant="outlined"
                            sx={{
                              p: 1.25,

                              borderColor:
                                editing
                                  ? 'warning.main'
                                  : 'divider',

                              bgcolor:
                                editing
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
                                alignItems={{
                                  md: 'center',
                                }}
                              >
                                <Chip
                                  size="small"
                                  label={
                                    `品番 ` +
                                    `${index + 1}`
                                  }
                                  variant="outlined"
                                />

                                <Box
                                  sx={{
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                >
                                  <Typography
                                    fontWeight={
                                      900
                                    }
                                    noWrap
                                  >
                                    {item
                                      .product
                                      ?.product_code ||
                                      '-'}
                                    　
                                    {item
                                      .product
                                      ?.name ||
                                      '-'}
                                  </Typography>

                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color:
                                        'text.secondary',
                                    }}
                                  >
                                    {productTypeLabel(
                                      item
                                        .product
                                        ?.product_type,
                                    )}
                                    {' / '}

                                    {factoryLabel(
                                      item.delivery_factory,
                                    ) ||
                                      '工場未設定'}

                                    {' / '}

                                    注文番号：
                                    {item.kawasaki_order_no ||
                                      '未設定'}

                                    {' / '}

                                    納品予定：
                                    {schedule.length}
                                    件・合計
                                    {scheduleTotal(
                                      item.delivery_schedule,
                                    )}
                                    冊
                                  </Typography>
                                </Box>

                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() =>
                                    setExpandedItemId(
                                      (
                                        previous,
                                      ) =>
                                        previous ===
                                        item.id
                                          ? ''
                                          : item.id,
                                    )
                                  }
                                >
                                  {expanded
                                    ? '詳細を閉じる'
                                    : '詳細'}
                                </Button>

                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() =>
                                    editItem(item)
                                  }
                                >
                                  修正
                                </Button>

                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  onClick={() =>
                                    deleteItem(item)
                                  }
                                >
                                  削除
                                </Button>
                              </Stack>

                              {/* 必要な時だけ納品予定を展開 */}
                              {expanded && (
                                <Box
                                  sx={{
                                    p: 1,

                                    borderRadius:
                                      1,

                                    bgcolor:
                                      'background.default',
                                  }}
                                >
                                  {item.memo && (
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        mb: 0.75,
                                      }}
                                    >
                                      <b>
                                        メモ：
                                      </b>
                                      {item.memo}
                                    </Typography>
                                  )}

                                  {schedule.length ===
                                  0 ? (
                                    <Typography variant="body2">
                                      納品予定は未設定です。
                                    </Typography>
                                  ) : (
                                    <Box
                                      sx={{
                                        display:
                                          'grid',

                                        gridTemplateColumns:
                                          'repeat(2, minmax(0, 1fr))',

                                        gap: 0.75,
                                      }}
                                    >
                                      {schedule.map(
                                        (
                                          row,
                                          scheduleIndex,
                                        ) => (
                                          <Typography
                                            key={
                                              row.id
                                            }
                                            variant="body2"
                                            sx={{
                                              p: 0.75,

                                              border:
                                                '1px solid',

                                              borderColor:
                                                'divider',

                                              borderRadius:
                                                1,
                                            }}
                                          >
                                            {scheduleIndex +
                                              1}
                                            .{' '}

                                            {formatDateJa(
                                              row.date,
                                            ) ||
                                              '日付未設定'}

                                            {' / '}

                                            {row.qty ||
                                              0}
                                            冊
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
                      },
                    )}
                  </Stack>
                )}
              </Stack>
            </Paper>

            {/* 品番入力欄 */}
            <Paper
              ref={editorRef}
              sx={{
                p: 2,
                scrollMarginTop: 90,
              }}
            >
              <Stack spacing={2}>
                <Stack
                  direction={{
                    xs: 'column',
                    md: 'row',
                  }}
                  spacing={1}
                  alignItems={{
                    md: 'center',
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      variant="h6"
                      fontWeight={900}
                    >
                      ③ 品番・納品情報を入力
                    </Typography>

                    <Typography
                      variant="body2"
                      sx={{
                        color:
                          'text.secondary',
                      }}
                    >
                      保存すると入力欄は空になり、同じ計画書を見ながら次の品番を続けて登録できます。
                    </Typography>
                  </Box>

                  {isEditingItem ? (
                    <Chip
                      label="既存明細を修正中"
                      color="warning"
                      variant="outlined"
                    />
                  ) : (
                    <Chip
                      label="新規明細"
                      color="primary"
                      variant="outlined"
                    />
                  )}

                  <Button
                    variant="text"
                    onClick={beginNextItem}
                  >
                    入力をクリア
                  </Button>
                </Stack>

                {!canAddNewItem && (
                  <Alert severity="warning">
                    この計画書には最大
                    {MAX_ITEMS_PER_PLAN}
                    品番が登録されています。既存品番を修正するか、新しい計画書を作成してください。
                  </Alert>
                )}

                {/* 品番・種類・商品名 */}
                <Box
                  sx={{
                    display: 'grid',

                    gridTemplateColumns: {
                      xs: '1fr',

                      md:
                        '1.15fr ' +
                        '0.85fr ' +
                        '1.15fr',
                    },

                    gap: 1.5,
                  }}
                >
                  <TextField
                    inputRef={
                      productCodeInputRef
                    }
                    label="品番【必須】"
                    value={
                      itemForm.productCode
                    }
                    onChange={(event) =>
                      setItemForm(
                        (previous) => ({
                          ...previous,

                          productCode:
                            event.target
                              .value,
                        }),
                      )
                    }
                    placeholder="例：99817-0001"
                    disabled={
                      !canAddNewItem
                    }
                  />

                  <FormControl
                    disabled={
                      !canAddNewItem
                    }
                  >
                    <InputLabel id="plan-product-type-label">
                      商品種類【必須】
                    </InputLabel>

                    <Select
                      labelId="plan-product-type-label"
                      label="商品種類【必須】"
                      value={
                        itemForm.productType
                      }
                      onChange={(event) =>
                        setItemForm(
                          (previous) => ({
                            ...previous,

                            productType:
                              event.target
                                .value,
                          }),
                        )
                      }
                    >
                      {PRODUCT_TYPE_OPTIONS.map(
                        (option) => (
                          <MenuItem
                            key={
                              option.value
                            }
                            value={
                              option.value
                            }
                          >
                            {option.label}
                          </MenuItem>
                        ),
                      )}
                    </Select>
                  </FormControl>

                  <TextField
                    label="商品名【必須】"
                    value={
                      itemForm.productName
                    }
                    onChange={(event) =>
                      setItemForm(
                        (previous) => ({
                          ...previous,

                          productName:
                            event.target
                              .value,
                        }),
                      )
                    }
                    placeholder="例：ZR900A / ZRT10G"
                    disabled={
                      !canAddNewItem
                    }
                  />
                </Box>

                <Divider />

                {/* 工場・注文番号 */}
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
                  <FormControl
                    disabled={
                      !canAddNewItem
                    }
                  >
                    <InputLabel id="plan-factory-label">
                      納品工場
                    </InputLabel>

                    <Select
                      labelId="plan-factory-label"
                      label="納品工場"
                      value={
                        itemForm.deliveryFactory
                      }
                      onChange={(event) =>
                        setItemForm(
                          (previous) => ({
                            ...previous,

                            deliveryFactory:
                              event.target
                                .value,
                          }),
                        )
                      }
                    >
                      <MenuItem value="">
                        <em>未設定</em>
                      </MenuItem>

                      {DELIVERY_FACTORY_OPTIONS.map(
                        (option) => (
                          <MenuItem
                            key={
                              option.value
                            }
                            value={
                              option.value
                            }
                          >
                            {option.label}
                          </MenuItem>
                        ),
                      )}
                    </Select>
                  </FormControl>

                  <TextField
                    label="川崎重工 注文番号"
                    value={
                      itemForm.kawasakiOrderNo
                    }
                    onChange={(event) =>
                      setItemForm(
                        (previous) => ({
                          ...previous,

                          kawasakiOrderNo:
                            event.target
                              .value,
                        }),
                      )
                    }
                    placeholder="例：KJ0001"
                    disabled={
                      !canAddNewItem
                    }
                  />
                </Box>

                <TextField
                  label="明細メモ（任意）"
                  value={itemForm.memo}
                  onChange={(event) =>
                    setItemForm(
                      (previous) => ({
                        ...previous,

                        memo:
                          event.target
                            .value,
                      }),
                    )
                  }
                  multiline
                  minRows={2}
                  fullWidth
                  disabled={
                    !canAddNewItem
                  }
                />

                <Divider />

                {/* 納品予定見出し */}
                <Stack
                  direction={{
                    xs: 'column',
                    md: 'row',
                  }}
                  spacing={1}
                  alignItems={{
                    md: 'center',
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      fontWeight={900}
                    >
                      納品予定
                      （追加数は無制限）
                    </Typography>

                    <Typography
                      variant="body2"
                      sx={{
                        color:
                          'text.secondary',
                      }}
                    >
                      10件前後入力してもページ全体が長くならないよう、この枠内だけスクロールします。
                    </Typography>
                  </Box>

                  <Chip
                    size="small"
                    label={
                      `入力中 ` +
                      `${cleanDeliveryRows.length}` +
                      `件`
                    }
                    variant="outlined"
                  />

                  <Button
                    variant="outlined"
                    onClick={
                      addDeliveryRow
                    }
                    disabled={
                      !canAddNewItem
                    }
                  >
                    納品予定を追加
                  </Button>
                </Stack>

                {/* 納品予定だけを内部スクロール */}
                <Box
                  sx={{
                    maxHeight: 430,

                    overflowY: 'auto',

                    pr: 0.5,

                    border: '1px solid',

                    borderColor:
                      'divider',

                    borderRadius: 1.5,

                    p: 1,

                    bgcolor:
                      'background.default',
                  }}
                >
                  <Stack spacing={1}>
                    {deliveryRows.map(
                      (row, index) => (
                        <Paper
                          key={row.id}
                          variant="outlined"
                          sx={{ p: 1 }}
                        >
                          <Box
                            sx={{
                              display:
                                'grid',

                              gridTemplateColumns:
                                {
                                  xs: '1fr',

                                  sm:
                                    '52px ' +
                                    'minmax(180px, 1fr) ' +
                                    'minmax(150px, 0.75fr) ' +
                                    '76px',
                                },

                              gap: 1,

                              alignItems:
                                'center',
                            }}
                          >
                            <Typography
                              variant="body2"
                              fontWeight={900}
                              sx={{
                                textAlign: {
                                  sm: 'center',
                                },
                              }}
                            >
                              {index + 1}
                            </Typography>

                            <TextField
                              type="date"
                              label={
                                `納品日 ` +
                                `${index + 1}`
                              }
                              value={row.date}
                              onChange={(
                                event,
                              ) =>
                                updateDeliveryRow(
                                  row.id,
                                  {
                                    date:
                                      event
                                        .target
                                        .value,
                                  },
                                )
                              }
                              InputLabelProps={{
                                shrink: true,
                              }}
                              size="small"
                              disabled={
                                !canAddNewItem
                              }
                            />

                            <TextField
                              label={
                                `納品数量 ` +
                                `${index + 1}`
                              }
                              value={row.qty}
                              onChange={(
                                event,
                              ) =>
                                updateDeliveryRow(
                                  row.id,
                                  {
                                    qty:
                                      event
                                        .target
                                        .value,
                                  },
                                )
                              }
                              placeholder="例：100"
                              size="small"
                              disabled={
                                !canAddNewItem
                              }
                            />

                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() =>
                                removeDeliveryRow(
                                  row.id,
                                )
                              }
                              disabled={
                                !canAddNewItem
                              }
                            >
                              削除
                            </Button>
                          </Box>
                        </Paper>
                      ),
                    )}

                    <Button
                      variant="outlined"
                      onClick={
                        addDeliveryRow
                      }
                      disabled={
                        !canAddNewItem
                      }
                    >
                      ＋ 納品予定をもう1件追加
                    </Button>
                  </Stack>
                </Box>

                {/* 保存ボタン */}
                <Box
                  sx={{
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 1,

                    bgcolor:
                      'background.paper',

                    borderTop:
                      '1px solid',

                    borderColor:
                      'divider',

                    pt: 1.5,
                    mt: 0.5,
                  }}
                >
                  <Stack
                    direction={{
                      xs: 'column',
                      sm: 'row',
                    }}
                    spacing={1}
                    alignItems={{
                      sm: 'center',
                    }}
                  >
                    <Button
                      variant="contained"
                      onClick={saveItem}
                      disabled={
                        savingItem ||
                        loading ||
                        !canAddNewItem
                      }
                    >
                      {savingItem
                        ? '保存中…'
                        : isEditingItem
                          ? '手配明細を更新して次へ'
                          : '手配追加して次の品番へ'}
                    </Button>

                    {isEditingItem && (
                      <Button
                        variant="outlined"
                        onClick={
                          beginNextItem
                        }
                      >
                        修正をやめて新規入力
                      </Button>
                    )}

                    <Typography
                      variant="body2"
                      sx={{
                        color:
                          'text.secondary',
                      }}
                    >
                      このボタンで、計画書画像・基本情報・現在の品番明細を同じセットへ保存します。
                    </Typography>
                  </Stack>
                </Box>
              </Stack>
            </Paper>

            {selectedPlan && (
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                }}
              >
                選択中セット：
                {formatDateJa(
                  selectedPlan.plan_date,
                )}
                {' / '}
                更新日時：
                {selectedPlan.updated_at
                  ? new Date(
                      selectedPlan.updated_at,
                    ).toLocaleString(
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