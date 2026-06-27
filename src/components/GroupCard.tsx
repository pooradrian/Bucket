import {Text, TouchableOpacity, View} from 'react-native';
import {GroupChat} from '../store';
import {useTheme} from '../ThemeContext';

interface GroupCardProps {
  item: GroupChat;
  isConfirmingDelete: boolean;
  onOpenChat: (group: GroupChat) => void;
  onEdit: (group: GroupChat) => void;
  onTriggerDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}

export default function GroupCard({
  item,
  isConfirmingDelete,
  onOpenChat,
  onEdit,
  onTriggerDelete,
  onConfirmDelete,
  onCancelDelete,
}: GroupCardProps) {
  const st = useTheme();

  return (
    <View style={st.characterCard}>
      <View
        style={[
          st.characterAvatar,
          {justifyContent: 'center', alignItems: 'center'},
        ]}>
        <Text style={{color: st.textMuted.color, fontSize: 20}}>
          {item.characterIds.length}
        </Text>
      </View>
      <View style={st.characterInfo}>
        <TouchableOpacity
          onPress={() => onOpenChat(item)}
          activeOpacity={0.7}>
          <Text style={st.characterName}>{item.name}</Text>
          {item.description ? (
            <Text style={st.characterDesc} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
          <Text style={st.characterDesc}>
            {item.characterIds.length} character
            {item.characterIds.length !== 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>

        <View style={st.cardActionRow}>
          {isConfirmingDelete ? (
            <>
              <TouchableOpacity
                onPress={() => onConfirmDelete(item.id)}
                style={st.confirmBtn}>
                <Text style={st.confirmBtnText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onCancelDelete}
                style={[st.cardActionBtn, st.cardActionBtnLast]}>
                <Text style={st.cardActionBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => onEdit(item)}
                style={st.cardActionBtn}>
                <Text style={st.cardActionBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onTriggerDelete(item.id)}
                style={[st.cardActionBtn, st.cardActionBtnLast]}>
                <Text style={st.cardActionBtnTextDanger}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}
