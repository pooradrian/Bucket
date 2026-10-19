import { Text, TouchableOpacity, View } from 'react-native';
import { Folder } from '../store';
import { useTheme } from '../ThemeContext';

interface FolderCardProps {
  item: Folder;
  characterCount: number;
  expanded: boolean;
  isConfirmingDelete: boolean;
  onToggleExpand: (id: string) => void;
  onRename: (folder: Folder) => void;
  onTriggerDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}

export default function FolderCard({
  item,
  characterCount,
  expanded,
  isConfirmingDelete,
  onToggleExpand,
  onRename,
  onTriggerDelete,
  onConfirmDelete,
  onCancelDelete,
}: FolderCardProps) {
  const st = useTheme();

  const toggle = () => onToggleExpand(item.id);

  return (
    <View style={st.characterCard}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.7}
        style={[
          st.characterAvatar,
          { justifyContent: 'center', alignItems: 'center' },
        ]}
      >
        <Text style={{ color: st.textMuted.color, fontSize: 20 }}>
          {expanded ? '▾' : '▸'}
        </Text>
      </TouchableOpacity>
      <View style={st.characterInfo}>
        <TouchableOpacity onPress={toggle} activeOpacity={0.7}>
          <Text style={st.characterName}>{item.name}</Text>
          <Text style={st.characterDesc}>
            {characterCount} character{characterCount !== 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>

        <View style={st.cardActionRow}>
          {isConfirmingDelete ? (
            <>
              <TouchableOpacity
                onPress={() => onConfirmDelete(item.id)}
                style={st.confirmBtn}
              >
                <Text style={st.confirmBtnText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onCancelDelete}
                style={[st.cardActionBtn, st.cardActionBtnLast]}
              >
                <Text style={st.cardActionBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => onRename(item)}
                style={st.cardActionBtn}
              >
                <Text style={st.cardActionBtnText}>Rename</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onTriggerDelete(item.id)}
                style={[st.cardActionBtn, st.cardActionBtnLast]}
              >
                <Text style={st.cardActionBtnTextDanger}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}
